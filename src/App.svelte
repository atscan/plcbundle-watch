<script lang="ts">
  import { onMount } from 'svelte';
  import { filesize } from 'filesize';
  import { formatDistanceToNow, addSeconds, subSeconds, formatDate, formatISO9075 } from 'date-fns';
  import { Progress, Switch } from '@skeletonlabs/skeleton-svelte';
  import orderBy from "lodash/orderBy";
  import BundleDownloader from './BundleDownloader.svelte';
  import { formatNumber, formatUptime } from './lib/utils';
  import instancesData from './instances.json';

  const APP_TITLE = 'plcbundle instances'
  const PLC_DIRECTORY = 'plc.directory'
  const ROOT = 'cbab6809a136d6a621906ee11199d3b0faf85b422fe0d0d2c346ce8e9dcd7485'
  const AUTO_REFRESH_INTERVAL = 10         // in seconds
  const BUNDLE_OPS = 10_000

  type StatusResponse = {
    bundles: {
      last_bundle: number;
      root_hash: string;
      head_hash: string;
      end_time?: string;
      total_size: number;
      uncompressed_size: number;
    };
    server: {
      uptime: number;
    };
    mempool?: {
      count: number;
      eta_next_bundle_seconds: number;
    };
    latency?: number;
  }

  type Instance = {
    url: string;
    cors?: boolean;
    status?: StatusResponse;
    modern?: boolean;
    _head?: boolean;
  }

  type LastKnownBundle = {
    number: number;
    hash: string | null;
    mempool: number | null;
    mempoolPercent: number;
    time?: string;
    etaNext?: Date;
    totalSize: number;
    totalSizeUncompressed: number;
  }

  let lastKnownBundle = $state<LastKnownBundle>({
    number: 0,
    hash: null,
    mempool: null,
    mempoolPercent: 0,
  })

  let isUpdating = $state(false)
  let canRefresh = $state(true)
  let isConflict = $state(false)
  let lastUpdated = $state(new Date())
  let autoRefreshEnabled = $state(true)
  let instances = $state<Instance[]>(instancesData.sort(() => Math.random() - 0.5))

  const instanceOrderBy = [['_head', 'status.bundles.last_bundle', 'status.latency'], ['desc', 'desc', 'asc']]

  async function getStatus(instance: Instance): Promise<StatusResponse | undefined> {
    let statusResp: StatusResponse | undefined;
    let url: string = instance.url;
    const start = performance.now();
    try {
      statusResp = await (await fetch(`${url}/status?${Number(new Date())}`)).json()
    } catch (e) {}
    if (!statusResp) {
      url = `https://keyoxide.org/api/3/get/http?url=${encodeURIComponent(url)}&format=text&time=${Date.now()}`
      const indexResp = await (await fetch(url)).text()
      const match = indexResp?.match(/Range:\s+(\d{6}) - (\d{6})/)
      if (match) {
        const [, from, to] = match
        const rootMatch = indexResp?.match(/Root: ([a-f0-9]{64})/)
        const headMatch = indexResp?.match(/Head: ([a-f0-9]{64})/)
        
        statusResp = {  
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
      statusResp.latency = performance.now() - start;
    }
    //if (instance.url === 'https://plc.j4ck.xyz') { statusResp.bundles.head_hash = 'f3ad3544452b2c078cba24990486bb9c277a1155'; }
    return statusResp
  }

  function recalculateHead() {
    isConflict = false
    const headHashes: string[] = []
    for (const instance of instances) {
      instance._head = instance.status?.bundles?.last_bundle === lastKnownBundle.number
      if (instance._head && instance.status?.bundles?.head_hash) {
        headHashes.push(instance.status.bundles.head_hash)
      }
    }
    isConflict = [...new Set(headHashes)].length > 1
  }

  async function doCheck() {
    isUpdating = true
    canRefresh = false
    for (const i of instances) {
      i.status = undefined
    }

    await Promise.all(instances.map(async (instance) => {
      const status = await getStatus(instance)
      instance.status = status
      if (status?.bundles?.last_bundle && status.bundles.last_bundle > lastKnownBundle.number) {
        lastKnownBundle.number = status.bundles.last_bundle
        lastKnownBundle.hash = status.bundles.head_hash
        lastKnownBundle.time = status.bundles.end_time

        if (status?.mempool?.count && (!lastKnownBundle.mempool || status.mempool.count > lastKnownBundle.mempool)) {
          lastKnownBundle.mempool = status.mempool.count
          lastKnownBundle.mempoolPercent = Math.round((lastKnownBundle.mempool/100)*100)/100
          lastKnownBundle.etaNext = addSeconds(new Date(), status.mempool.eta_next_bundle_seconds)
          lastKnownBundle.totalSize = status.bundles.total_size
          lastKnownBundle.totalSizeUncompressed = status.bundles.uncompressed_size
        }
      }
      lastUpdated = new Date()

      recalculateHead()
    }))
    isUpdating = false
    updateTitle()
    setTimeout(() => { canRefresh = true }, 500)
  }

  function updateTitle() {
    const arr: string[] = []
    if (lastUpdated) {
      const upCount = instances.filter(i => i._head)
      arr.push(`${isConflict ? '⚠️' : '✅'} [${upCount.length}/${instances.length}]`)
    }
    document.title = [...arr, APP_TITLE].join(' ')
    return true
  }

  let autoRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(async () => {
    await doCheck()

    const scheduleRefresh = () => {
      autoRefreshTimer = setTimeout(() => {
        if (autoRefreshEnabled) {
          doCheck()
        }
        scheduleRefresh()
      }, AUTO_REFRESH_INTERVAL * 1000)
    }
    
    scheduleRefresh()

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
          <Switch.Control className="data-[state=checked]:preset-filled-success-500">
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
        </div>
      </div>
      <div>
        <div>
            <h2 class="opacity-75 text-sm">Next bundle</h2>
        </div>
        <div class="flex gap-4">
          <div class="mt-4">
            <Progress value={lastKnownBundle.mempoolPercent} class="items-center">
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
            <div><span class="opacity-50">Instances:</span> {instances.filter(i => i._head).length} latest / {instances.length} total</div>
            <div><span class="opacity-50">Bundles Size:</span> {filesize(lastKnownBundle.totalSize)}</div>
            <div><span class="opacity-50">Uncompressed:</span> {filesize(lastKnownBundle.totalSizeUncompressed)}</div>
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
          <th>root</th>
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
            <td>{#if instance._head}{#if isConflict}⚠️{:else}✅{/if}{:else if instance.status}🔄{:else}⌛{/if}</td>
            <td>{#if instance.status?.bundles?.last_bundle}{instance.status?.bundles?.last_bundle}{/if}</td>
            <td>{#if instance.status?.mempool && instance._head}{formatNumber(instance.status?.mempool.count)}{:else if instance.status}<span class="opacity-25 text-xs">syncing</span>{/if}</td>
            <td class="text-xs opacity-50">{#if instance.status?.mempool && instance._head}{instance.status?.mempool.last_op_age_seconds || 0}s{/if}</td>
            <td><span class="font-mono text-xs {instance._head ? (isConflict ? 'text-error-600' : 'text-success-600') : 'opacity-50'}">{#if instance.status?.bundles?.head_hash}{instance.status?.bundles?.head_hash.slice(0, 7)}{/if}</span></td>
            <td><span class="font-mono text-xs {instance.status ? (instance.status?.bundles?.root_hash === ROOT ? 'text-success-600' : 'text-error-600') : ''}">{#if instance.status?.bundles?.root_hash}{instance.status?.bundles?.root_hash.slice(0, 7)}{/if}</span></td>
            <td class="text-xs">{#if instance.status?.server?.version}<a href="{instance.url}/status">{instance.status?.server?.version}</a>{/if}</td>
            <td class="text-xs">{#if instance.status?.server?.websocket_enabled}✔︎{:else if instance.status}<span class="opacity-25">-</span>{/if}</td>
            <td class="text-xs">{#if instance.status?.server?.uptime_seconds}{formatUptime(instance.status?.server?.uptime_seconds)}{/if}</td>
            <td class="text-xs opacity-50">{#if instance.status?.latency}{Math.round(instance.status?.latency)}ms{/if}</td>
          </tr>
        {/each}
      </tbody>
    </table>


    <div class="mt-12">
      <div>
        <span class="opacity-75">PLC Directory:</span> <a href="https://{PLC_DIRECTORY}">{PLC_DIRECTORY}</a> <span class="opacity-50">(origin)</span>
      </div>      
      <div class="mt-2">
        <span class="opacity-75">Root:</span> <span class="font-mono text-xs">{ROOT.slice(0)}</span>
      </div>

      <div class="mt-6 opacity-50">
        Last updated: {formatISO9075(lastUpdated)}
      </div>
    </div>
    <hr class="hr my-10" />

    <BundleDownloader instances={instances} />

    <hr class="hr mb-6 mt-12" />
    <div class="opacity-50">
      <div class="mt-4">
        Source: <a href="https://tangled.org/@tree.fail/plcbundle-watch">https://tangled.org/@tree.fail/plcbundle-watch</a>
      </div>
    </div>
  

  </div>
</main>

