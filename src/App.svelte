<script lang="ts">

  import { onMount } from 'svelte';
  import { filesize } from 'filesize';
  import { formatDistanceToNow, addSeconds, subSeconds, formatDate, formatISO9075 } from 'date-fns';
  import { Progress, Switch } from '@skeletonlabs/skeleton-svelte';
  import orderBy from 'lodash/orderBy';
  import BundleDownloader from './BundleDownloader.svelte';
  import { formatNumber, formatUptime } from './lib/utils';
  import instancesData from './instances.json';

  const APP_TITLE = 'plcbundle instances'
  const PLC_DIRECTORY = 'plc.directory'
  const ROOT = 'cbab6809a136d6a621906ee11199d3b0faf85b422fe0d0d2c346ce8e9dcd7485'
  const AUTO_REFRESH_INTERVAL = 10         // in seconds
  const BUNDLE_OPS = 10_000

  type StatusResponse = {
    ok: boolean;
    bundles: {
      last_bundle: number;
      root_hash: string;
      head_hash: string;
      end_time?: string;
      total_size?: number;
      uncompressed_size?: number;
    };
    server: {
      uptime: number;
    };
    mempool?: {
      count: number;
      eta_next_bundle_seconds: number;
      last_time: Date;
    };
    latency?: number;
  }

  type StatusResponseError = {
    error: string;
  }

  type Instance = {
    url: string;
    cors?: boolean;
    status?: StatusResponse | StatusResponseError;
    modern?: boolean;
    _head?: boolean;
    _conflict?: boolean;
  }

  type LastKnownBundle = {
    number: number;
    hash: string | null;
    mempool: number | null;
    mempoolPercent: number;
    mempoolBundle: number;
    lastTime?: Date;
    time?: string;
    etaNext?: Date | null;
    totalSize?: number | null;
    totalSizeUncompressed?: number | null;
  }

  let lastKnownBundle = $state<LastKnownBundle>({
    number: 0,
    hash: null,
    mempool: null,
    mempoolBundle: 0,
    mempoolPercent: 0,
  })

  let isUpdating = $state(false)
  let canRefresh = $state(true)
  let consensus = $state({})
  let isConflict = $state(consensus)
  let instancesInConflict = $state<string[]>([])
  let lastUpdated = $state(new Date())
  let autoRefreshEnabled = $state(true)
  let instances = $state<Instance[]>(instancesData.sort(() => Math.random() - 0.5))

  const instanceOrderBy = [['status.error', '_head', 'status.bundles.last_bundle', 'status.latency'], ['desc', 'desc', 'desc', 'asc']]

  async function getStatus(instance: Instance): Promise<StatusResponse | StatusResponseError> {
    let statusResp: StatusResponse | undefined;
    let url: string = instance.url;
    let lastError: string | undefined;
    const start = performance.now();
    try {
      statusResp = await (await fetch(`${url}/status?${Number(new Date())}`)).json()
    } catch (e: any) {
      lastError = e.message;
    }
    if (!statusResp) {
      url = `https://keyoxide.org/api/3/get/http?url=${encodeURIComponent(url)}&format=text&time=${Date.now()}`

      let indexResp: string | undefined;
      try {
        indexResp = await (await fetch(url)).text()
      } catch(e: any) {
        lastError = e.message;
      }
      const match = indexResp?.match(/Range:\s+(\d{6}) - (\d{6})/)
      if (match) {
        const [, from, to] = match
        const rootMatch = indexResp?.match(/Root: ([a-f0-9]{64})/)
        const headMatch = indexResp?.match(/Head: ([a-f0-9]{64})/)
        
        statusResp = {  
          ok: true,
          bundles: {
            last_bundle: Number(to),
            root_hash: rootMatch ? rootMatch[1] : '',
            head_hash: headMatch ? headMatch[1] : '',
          },
          server: {
            uptime: 1,
          }
        }
      }
    }
    if (statusResp) {
      statusResp.ok = true
      statusResp.latency = performance.now() - start;
    }
    //if (instance.url === 'https://plc.j4ck.xyz') { statusResp.bundles.head_hash = 'f3ad3544452b2c078cba24990486bb9c277a1155'; }
    return statusResp ?? { error: lastError || 'unknown error' }
  }

  function recalculateHead() {
    isConflict = false
    instancesInConflict = []
    const headHashes: any = {}
    for (const instance of instances) {
      if (instance.status && 'error' in instance.status) {
        continue
      }
      instance._head = instance.status?.bundles?.last_bundle === lastKnownBundle.number
      if (instance._head && instance.status?.bundles?.head_hash) {
        if (!headHashes[instance.status.bundles.head_hash]) {
          headHashes[instance.status.bundles.head_hash] = []
        }
        headHashes[instance.status.bundles.head_hash].push(instance.url)
      }
    }
    // second pass
    const sorted: any = Object.fromEntries(
      Object.entries(headHashes).sort(([, a]: any, [, b]: any) => b.length - a.length)
    )
    for (const instance of instances) {
      if (Object.keys(sorted).length > 1 && Object.keys(sorted)[1] && sorted[Object.keys(sorted)[1]].includes(instance.url)) {
        instance._conflict = true
        instancesInConflict.push(instance.url)
      }
    }
    //const uniq = [...new Set(headHashes)]
    isConflict = instancesInConflict.length > Math.ceil(instances.length/2)
  }

  async function doCheck() {
    isUpdating = true
    canRefresh = false
    for (const i of instances) {
      if (i.status && 'ok' in i.status) {
        i.status.ok = false
      }
    }

    await Promise.all(instances.map(async (instance) => {
      const status = await getStatus(instance)
      if (!status) {
        return false
      }

      instance.status = status
      if ('ok' in status && status.ok) {

        if (status?.bundles?.last_bundle && status.bundles.last_bundle >= lastKnownBundle.number) {
          lastKnownBundle.number = status.bundles.last_bundle
          lastKnownBundle.hash = status.bundles.head_hash
          lastKnownBundle.time = status.bundles.end_time

          if (status?.mempool?.count && (!lastKnownBundle.mempool || status.mempool.count > lastKnownBundle.mempool || status.bundles.last_bundle > lastKnownBundle.mempoolBundle)) {
            lastKnownBundle.mempoolBundle = status.bundles.last_bundle
            lastKnownBundle.mempool = status.mempool.count
            lastKnownBundle.lastTime = status.mempool.last_time
            lastKnownBundle.mempoolPercent = Math.round((lastKnownBundle.mempool/100)*100)/100
            lastKnownBundle.etaNext = status.mempool.eta_next_bundle_seconds ? addSeconds(new Date(), status.mempool.eta_next_bundle_seconds) : null
            lastKnownBundle.totalSize = status.bundles.total_size
            lastKnownBundle.totalSizeUncompressed = status.bundles.uncompressed_size
          }
        }
      }
      
      lastUpdated = new Date()

      recalculateHead()
    }))
    isUpdating = false
    updateTitle()
    setTimeout(() => { canRefresh = true }, 500)
  }

  function normalizedVersion(version: string) {
    const m = version.trim().match(/^([^\s]+)\.\d+\.\d+\-[0-9a-f]+\+dirty$/)
    if (m) {
      return `${m[1]}+dev`
    }
    return version
  }

  function updateTitle() {
    const arr: string[] = []
    if (lastUpdated) {
      const upCount = instances.filter(i => i._head && !i._conflict)
      arr.push(`${isConflict ? '⚠️' : '✅'} [${upCount.length}/${instances.length}]`)
    }
    document.title = [...arr, APP_TITLE].join(' ')
    return true
  }

  let autoRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() =>  {
    doCheck().then(() => {
      const scheduleRefresh = () => {
        autoRefreshTimer = setTimeout(() => {
          if (autoRefreshEnabled) {
            doCheck()
          }
          scheduleRefresh()
        }, AUTO_REFRESH_INTERVAL * 1000)
      }
      
      scheduleRefresh()

    })

    return () => {
      if (autoRefreshTimer) {
        clearTimeout(autoRefreshTimer)
      }
    }
  })
</script>

<main class="w-full mt-10 mb-16">
  <div class="max-w-5xl mx-auto px-3">

    <header class="flex items-center gap-10 flex-wrap">
      <div class="grow">
        <h1 class="text-3xl linear-text-gradient"><a href="https://plcbundle-watch.pages.dev/" class="no-style">plcbundle instances</a></h1>
      </div>
      <div class="flex items-center gap-6">
        <Switch class="opacity-75" checked={autoRefreshEnabled} onCheckedChange={(x) => autoRefreshEnabled = x.checked} disabled={isUpdating}>
          <Switch.Control class="data-[state=checked]:preset-filled-success-500">
            <Switch.Thumb />
          </Switch.Control>
          <Switch.Label>Auto-refresh ({AUTO_REFRESH_INTERVAL}s)</Switch.Label>
          <Switch.HiddenInput />
        </Switch>
        <button type="button" class="btn btn-sm preset-tonal-primary"  onclick={() => doCheck()} disabled={isUpdating || canRefresh === false}>Refresh</button>
      </div>      
    </header>

    <div class="gap-10 mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <h2 class="opacity-75 text-sm">Last known bundle</h2>
        <div>
          <div class="flex items-center gap-5">
            <div class="font-semibold text-3xl">{lastKnownBundle.number}</div>
            {#if !isConflict}
              <div class="mt-1 font-mono badge preset-outlined-primary-500 text-xs">{lastKnownBundle?.hash?.slice(0, 7)}</div>
            {:else}
              <div class="mt-1 badge preset-filled-error-500">⚠️ conflict!</div>
            {/if}
          </div>
          <div>
            <span class="opacity-50">{#if lastKnownBundle?.time} {formatDistanceToNow(lastKnownBundle.time, { addSuffix: true })}{/if}</span>
          </div>
          <div class="mt-1">
            {#if instancesInConflict.length > 0}
              ⚠️ Fork alert on {instancesInConflict.length} instances!
            {:else if !isConflict}
              ✅ Everything fine!
            {/if}
          </div>
        </div>
      </div>
      <div>
        <div>
            <h2 class="opacity-75 text-sm">Next bundle</h2>
        </div>
        <div class="flex gap-4">
          <div class="mt-4">
            <Progress value={lastKnownBundle.mempoolPercent} class="items-center {lastKnownBundle.mempoolPercent > 98 ? 'animate-pulse' : ''}">
              <Progress.Circle style="--size: 64px; --thickness: 10px;">
                <Progress.CircleTrack />
                <Progress.CircleRange />
              </Progress.Circle>
              <!--Progress.ValueText class="text-xs opacity-50" /-->
            </Progress>
          </div>
          {#if lastKnownBundle.number > 0}
            <div>
              <div class="font-semibold text-2xl animate-pulse">{lastKnownBundle.number + 1}</div>
              <div>{formatNumber(lastKnownBundle.mempool || 0)} / {formatNumber(BUNDLE_OPS)} <span class="opacity-50">({lastKnownBundle.mempoolPercent}%)</span></div>
              {#if lastKnownBundle.etaNext}
                <div class="mt-1 opacity-50">ETA: {formatDistanceToNow(lastKnownBundle.etaNext)}</div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
      {#if lastKnownBundle.number > 0}
        <div class="">
          <div>
              <h2 class="opacity-75 text-sm">Statistics</h2>
          </div>
          <div class="mt-2 grid grid-cols-1 gap-1">
            <div><span class="opacity-50">Instances:</span> {instances.filter(i => i._head && !i._conflict).length} latest / {instances.length} total</div>
            <div><span class="opacity-50">PLC Operations:</span> {formatNumber((lastKnownBundle.number * BUNDLE_OPS) + (lastKnownBundle.mempool || 0))}</div>
            <div><span class="opacity-50">Bundles Size:</span> {#if lastKnownBundle.totalSize}{filesize(lastKnownBundle.totalSize)}{/if}</div>
            <div><span class="opacity-50">Uncompressed:</span> {#if lastKnownBundle.totalSizeUncompressed}{filesize(lastKnownBundle.totalSizeUncompressed)}{/if}</div>
          </div>
        </div>
      {/if}
    </div>      

    <table class="table mt-10">
      <thead>
        <tr>
          <th>endpoint</th>
          <th>ok?</th>
          <th>last</th>
          <th>mempool</th>    
          <th>age</th>      
          <th>head</th>
          <th>first</th>
          <th>version</th>
          <th>ws?</th>
          <th>uptime</th>
          <th>latency</th>
        </tr>
      </thead>
      <tbody class="[&>tr]:hover:bg-primary-500/10">
        {#each orderBy(instances, ...instanceOrderBy) as instance}
          <tr>
            <td><a href={instance.url} target="_blank" class="font-semibold">{instance.url.replace("https://", "")}</a></td>
            <td>{#if instance._head && instance.status?.ok}{#if instance._conflict}⚠️{:else}✅{/if}{:else if instance.status && instance.status?.ok}🔄{:else if instance.status?.error}❌{:else}⌛{/if}</td>
            {#if instance.status?.error}
              <td colspan="5" class="opacity-50 text-xs">Error: {instance.status?.error}</td>
            {:else}
              <td>{#if instance.status?.bundles?.last_bundle}<span class="{instance._conflict ? 'text-error-600' : ''}">{instance.status?.bundles?.last_bundle}</span>{/if}</td>
              <td>{#if instance.status?.mempool && instance._head}<span class="{instance._conflict ? 'text-error-600' : ''}">{formatNumber(instance.status?.mempool.count)}</span>{:else if instance.status?.error}<span class="opacity-25 text-xs">error</span>{:else if instance.status}<span class="opacity-25 text-xs">syncing</span>{/if}</td>
              <td>{#if instance.status?.mempool && instance._head}<span class="text-xs opacity-50 {instance._conflict ? 'text-error-600' : ''}">{instance.status?.mempool.last_op_age_seconds || 0}s</span>{/if}</td>
              <td><span class="font-mono text-xs {instance._head ? (instance._conflict ? 'text-error-600' : 'text-success-600') : 'opacity-50'}">{#if instance.status?.bundles?.head_hash}{instance.status?.bundles?.head_hash.slice(0, 7)}{/if}</span></td>
              <td><span class="font-mono text-xs {instance.status ? (instance.status?.bundles?.root_hash === ROOT ? 'text-success-600' : 'text-error-600') : ''}">{#if instance.status?.bundles?.root_hash}{instance.status?.bundles?.root_hash.slice(0, 7)}{/if}</span></td>
            {/if}

            <td class="text-xs">{#if instance.status?.server?.version}<span title={instance.status?.server?.version}>{normalizedVersion(instance.status?.server?.version)}</span>{/if}</td>
            <td class="text-xs">{#if instance.status?.server?.websocket_enabled}✔︎{:else if instance.status}<span class="opacity-25">-</span>{/if}</td>
            <td class="text-xs">{#if instance.status?.server?.uptime_seconds}{formatUptime(instance.status?.server?.uptime_seconds)}{/if}</td>
            <td class="text-xs opacity-50">{#if instance.status?.latency}<a href="{instance.url}/status">{Math.round(instance.status?.latency)}ms</a>{/if}</td>
          </tr>
        {/each}
      </tbody>
    </table>


    <div class="mt-12">
      <div>
        <span class="opacity-75">PLC Directory:</span> <a href="https://{PLC_DIRECTORY}">{PLC_DIRECTORY}</a> <span class="opacity-50">(origin)</span>
      </div>      
      <div class="mt-2">
        <span class="opacity-75">First hash (root):</span> <span class="font-mono text-xs">{ROOT.slice(0)}</span>
      </div>

      <div class="mt-6 opacity-50">
        Last updated: {formatISO9075(lastUpdated)}
      </div>
    </div>
    <hr class="hr my-10" />

    <BundleDownloader instances={instances} />

    <hr class="hr mb-6 mt-12" />
    <div class="opacity-50">
      <div class="mt-4 text-sm">
        <a href="https://tangled.org/@tree.fail/plcbundle-watch">Source Code</a> | ❤️ Made with love for <a href="https://atproto.com/">#atproto</a> community by <a href="https://bsky.app/profile/tree.fail">@tree.fail</a> using <a href="https://vite.dev/">Vite</a> & <a href="https://svelte.dev/">Svelte</a>
      </div>
    </div>
  

  </div>
</main>

