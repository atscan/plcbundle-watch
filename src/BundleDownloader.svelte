<script lang="ts">
  import { Progress } from '@skeletonlabs/skeleton-svelte';
  import { tick } from 'svelte';
  
  type Instance = {
    url: string;
    name?: string;
  }

  type InstanceStatus = {
    url: string;
    lastBundle: number;
  }

  type DownloadedBundle = {
    number: number;
    status: 'downloading' | 'success' | 'error' | 'cancelled';
    size?: number;
    error?: string;
    source?: string;
  }

  let { instances = [] }: { instances: Instance[] } = $props();

  let selectedInstance = $state('random');
  let bundlesInput = $state('');
  let isDownloading = $state(false);
  let downloadedBundles = $state<DownloadedBundle[]>([]);
  let progress = $state(0);
  let totalBundles = $state(0);
  let abortController: AbortController | null = null;
  let isStopping = $state(false);
  let instanceStatuses = $state<InstanceStatus[]>([]);
  let useDirectory = $state(true);
  let directoryHandle: FileSystemDirectoryHandle | null = null;
  let hasFileSystemAccess = $state(false);

  // Check if File System Access API is available
  $effect(() => {
    hasFileSystemAccess = 'showDirectoryPicker' in window;
    if (!hasFileSystemAccess) {
      useDirectory = false;
    }
  });

  async function pickDirectory(): Promise<boolean> {
    if (!hasFileSystemAccess) {
      return false;
    }

    try {
      directoryHandle = await (window as any).showDirectoryPicker({
        mode: 'readwrite'
      });
      return true;
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        console.error('Failed to pick directory:', e);
      }
      return false;
    }
  }

  async function fetchInstanceStatuses() {
    const statuses: InstanceStatus[] = [];
    
    await Promise.all(instances.map(async (instance) => {
      try {
        const response = await fetch(`${instance.url}/status`, {
          signal: abortController?.signal
        });
        const data = await response.json();
        statuses.push({
          url: instance.url,
          lastBundle: data.bundles.last_bundle
        });
      } catch (e) {
        console.warn(`Failed to fetch status from ${instance.url}`, e);
      }
    }));
    
    return statuses;
  }

  function getAvailableInstancesForBundle(bundleNumber: number): string[] {
    return instanceStatuses
      .filter(s => s.lastBundle >= bundleNumber)
      .map(s => s.url);
  }

  function getRandomInstance(bundleNumber?: number): Instance | null {
    let availableUrls: string[];
    
    if (bundleNumber !== undefined && instanceStatuses.length > 0) {
      availableUrls = getAvailableInstancesForBundle(bundleNumber);
      if (availableUrls.length === 0) {
        return null;
      }
    } else {
      availableUrls = instances.map(i => i.url);
    }
    
    const randomUrl = availableUrls[Math.floor(Math.random() * availableUrls.length)];
    return instances.find(i => i.url === randomUrl) || null;
  }

  function getInstanceUrl(bundleNumber?: number): string | null {
    if (selectedInstance === 'random') {
      const instance = getRandomInstance(bundleNumber);
      return instance?.url || null;
    }
    return selectedInstance;
  }

  function getInstanceName(url: string): string {
    const instance = instances.find(i => i.url === url);
    return instance?.name || new URL(url).hostname;
  }

  function parseBundlesInput(input: string): number[] | 'all' {
    const trimmed = input.trim();
    
    if (!trimmed) {
      return 'all';
    }

    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-').map(s => parseInt(s.trim()));
      if (isNaN(start) || isNaN(end) || start > end) {
        throw new Error('Invalid range format');
      }
      const bundles = [];
      for (let i = start; i <= end; i++) {
        bundles.push(i);
      }
      return bundles;
    }

    const num = parseInt(trimmed);
    if (isNaN(num)) {
      throw new Error('Invalid bundle number');
    }
    return [num];
  }

  async function getLastBundle(instanceUrl: string): Promise<number> {
    const response = await fetch(`${instanceUrl}/status`, {
      signal: abortController?.signal
    });
    const data = await response.json();
    return data.bundles.last_bundle;
  }

  async function downloadBundle(instanceUrl: string, bundleNumber: number): Promise<Blob> {
    const response = await fetch(`${instanceUrl}/data/${bundleNumber}`, {
      signal: abortController?.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.blob();
  }

  function padBundleNumber(num: number): string {
    return num.toString().padStart(6, '0');
  }

  async function saveFileToDirectory(blob: Blob, bundleNumber: number) {
    if (!directoryHandle) {
      throw new Error('No directory selected');
    }

    const fileName = `${padBundleNumber(bundleNumber)}.jsonl.zst`;
    const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  function saveFileBrowser(blob: Blob, bundleNumber: number) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${padBundleNumber(bundleNumber)}.jsonl.zst`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function stopDownload() {
    if (abortController) {
      isStopping = true;
      abortController.abort();
    }
  }

  async function handleDownload() {
    if (!selectedInstance) {
      alert('Please select an instance');
      return;
    }

    // If using directory mode, pick directory first
    if (useDirectory && hasFileSystemAccess) {
      const picked = await pickDirectory();
      if (!picked) {
        return; // User cancelled
      }
    }

    let bundleNumbers: number[];
    abortController = new AbortController();
    isStopping = false;

    try {
      if (selectedInstance === 'random') {
        instanceStatuses = await fetchInstanceStatuses();
        if (instanceStatuses.length === 0) {
          alert('No instances available');
          return;
        }
      }

      const parsed = parseBundlesInput(bundlesInput);
      
      if (parsed === 'all') {
        let lastBundle: number;
        
        if (selectedInstance === 'random') {
          lastBundle = Math.max(...instanceStatuses.map(s => s.lastBundle));
        } else {
          lastBundle = await getLastBundle(selectedInstance);
        }
        
        bundleNumbers = [];
        for (let i = 1; i <= lastBundle; i++) {
          bundleNumbers.push(i);
        }
      } else {
        bundleNumbers = parsed;
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return;
      }
      alert(e instanceof Error ? e.message : 'Invalid input');
      return;
    }

    isDownloading = true;
    downloadedBundles = [];
    progress = 0;
    totalBundles = bundleNumbers.length;

    for (let i = 0; i < bundleNumbers.length; i++) {
      if (abortController?.signal.aborted) {
        break;
      }

      const bundleNum = bundleNumbers[i];
      const instanceUrl = getInstanceUrl(bundleNum);
      
      if (!instanceUrl) {
        downloadedBundles = [...downloadedBundles, {
          number: bundleNum,
          status: 'error',
          error: 'No instance has this bundle',
        }];
        progress = Math.round(((i + 1) / totalBundles) * 100);
        await tick();
        continue;
      }
      
      downloadedBundles = [...downloadedBundles, {
        number: bundleNum,
        status: 'downloading',
        source: instanceUrl,
      }];
      
      await tick();

      try {
        const blob = await downloadBundle(instanceUrl, bundleNum);
        
        if (abortController?.signal.aborted) {
          downloadedBundles = downloadedBundles.map(b => 
            b.number === bundleNum ? { ...b, status: 'cancelled' as const } : b
          );
          break;
        }

        // Save file
        if (useDirectory && directoryHandle) {
          await saveFileToDirectory(blob, bundleNum);
        } else {
          saveFileBrowser(blob, bundleNum);
        }

        downloadedBundles = downloadedBundles.map(b => 
          b.number === bundleNum 
            ? { ...b, status: 'success' as const, size: blob.size } 
            : b
        );
        
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          downloadedBundles = downloadedBundles.map(b => 
            b.number === bundleNum ? { ...b, status: 'cancelled' as const } : b
          );
          break;
        }
        
        downloadedBundles = downloadedBundles.map(b => 
          b.number === bundleNum 
            ? { ...b, status: 'error' as const, error: e instanceof Error ? e.message : 'Unknown error' } 
            : b
        );
      }
      
      progress = Math.round(((i + 1) / totalBundles) * 100);
      await tick();
    }

    isDownloading = false;
    isStopping = false;
    abortController = null;
    directoryHandle = null;
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  function clearResults() {
    downloadedBundles = [];
    progress = 0;
    totalBundles = 0;
  }

  let successCount = $derived(downloadedBundles.filter(b => b.status === 'success').length);
  let errorCount = $derived(downloadedBundles.filter(b => b.status === 'error').length);
  let cancelledCount = $derived(downloadedBundles.filter(b => b.status === 'cancelled').length);
  let totalSize = $derived(downloadedBundles.reduce((sum, b) => sum + (b.size || 0), 0));
</script>

<div class="bundle-downloader card space-y-4">
  <h2 class="text-2xl">Bundle Downloader</h2>

  <div class="space-y-3">
    <label class="label">
      <span>Instance</span>
      <select 
        class="select p-3 text-sm" 
        bind:value={selectedInstance}
        disabled={isDownloading}
      >
        <option value="random">🎲 Random (each bundle from different source)</option>
        {#each instances as instance}
          <option value={instance.url}>
            {instance.name || instance.url}
          </option>
        {/each}
      </select>
    </label>

    <label class="label">
      <span>Bundles</span>
      <input 
        class="input text-sm" 
        type="text" 
        bind:value={bundlesInput}
        disabled={isDownloading}
        placeholder="empty = all, 5 = single, 1-10 = range"
      />
      <p class="text-xs opacity-75 mt-1">
        Leave empty for all bundles, enter a number (e.g., <code>5</code>) or range (e.g., <code>1-10</code>)
      </p>
    </label>

    {#if hasFileSystemAccess}
      <label class="flex items-center space-x-2">
        <input 
          type="checkbox" 
          class="checkbox"
          bind:checked={useDirectory}
          disabled={isDownloading}
        />
        <span class="text-sm">
          📁 Save to directory (recommended for multiple files)
        </span>
      </label>
    {:else}
      <div class="alert variant-ghost-warning p-2 text-xs">
        <span>⚠️ Directory mode not available in this browser. Files will download individually.</span>
      </div>
    {/if}

    <div class="flex gap-2">
      {#if !isDownloading}
        <button 
          class="btn preset-tonal-primary flex-1"
          onclick={handleDownload}
        >
          {useDirectory && hasFileSystemAccess ? '📁 Choose Directory & Download' : '📥 Download'}
        </button>
        {#if downloadedBundles.length > 0}
          <button 
            class="btn preset-tonal-surface"
            onclick={clearResults}
          >
            🗑️ Clear
          </button>
        {/if}
      {:else}
        <button 
          class="btn preset-filled-error-500 flex-1"
          onclick={stopDownload}
          disabled={isStopping}
        >
          {isStopping ? '⏳ Stopping...' : '⛔ Stop'}
        </button>
      {/if}
    </div>

    {#if isDownloading}
      <div class="space-y-2">
        <Progress value={progress} max={100} />
        <p class="text-sm text-center font-semibold">
          {progress}% ({successCount}/{totalBundles})
        </p>
      </div>
    {/if}
  </div>

  {#if downloadedBundles.length > 0}
    <div class="space-y-2">
      <h3 class="text-2xl">
        {isDownloading ? 'Downloading...' : 'Results'} 
        ({successCount}/{downloadedBundles.length})
      </h3>
      
      <div class="table-container max-h-64 overflow-y-auto">
        <table class="table table-compact table-hover">
          <thead>
            <tr>
              <th>File</th>
              <th>Source</th>
              <th>Status</th>
              <th class="text-right">Size</th>
            </tr>
          </thead>
          <tbody>
            {#each downloadedBundles as bundle (bundle.number)}
              <tr>
                <td class="font-mono text-xs">{padBundleNumber(bundle.number)}.jsonl.zst</td>
                <td class="text-xs" title={bundle.source}>
                  {bundle.source ? getInstanceName(bundle.source) : '-'}
                </td>
                <td>
                  {#if bundle.status === 'downloading'}
                    <span class="badge variant-filled text-xs">⏳ Downloading</span>
                  {:else if bundle.status === 'success'}
                    <span class="badge variant-filled-success text-xs">✅ Success</span>
                  {:else if bundle.status === 'cancelled'}
                    <span class="badge variant-filled-warning text-xs">⚠️ Cancelled</span>
                  {:else}
                    <span class="badge variant-filled-error text-xs" title={bundle.error}>❌ Error</span>
                  {/if}
                </td>
                <td class="text-sm text-right">{bundle.size ? formatBytes(bundle.size) : '-'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <div class="card p-3 variant-ghost-surface grid grid-cols-4 gap-2 text-sm">
        <div>
          <div class="font-bold text-success-500">
            {successCount}
          </div>
          <div class="opacity-75">Success</div>
        </div>
        <div>
          <div class="font-bold text-error-500">
            {errorCount}
          </div>
          <div class="opacity-75">Failed</div>
        </div>
        <div>
          <div class="font-bold text-warning-500">
            {cancelledCount}
          </div>
          <div class="opacity-75">Cancelled</div>
        </div>
        <div>
          <div class="font-bold">
            {formatBytes(totalSize)}
          </div>
          <div class="opacity-75">Total</div>
        </div>
      </div>
    </div>
  {/if}
</div>
