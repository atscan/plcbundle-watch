<script lang="ts">
  import { onMount } from 'svelte';
  import { formatDistanceToNow, addSeconds, formatDate, formatISO9075 } from 'date-fns';
  import { Progress, Switch } from '@skeletonlabs/skeleton-svelte';
  import orderBy from "lodash/orderBy";
  import instancesData from './instances.json';
  import numeral from 'numeral';
  
  const AUTO_REFRESH_INTERVAL = 15         // in seconds
  const BUNDLE_OPS = 10_000

  type Instance = {
    url: string,
    cors?: boolean,
    status?: object,
    modern?: boolean,
  }

  let lastKnownBundle = $state({
    number: 0,
    hash: null,
    mempool: null,
    mempoolPercent: 0,
  })

  let isUpdating = $state(false)
  let canRefresh = $state(true)
  let lastUpdated = $state(new Date())
  let autoRefreshEnabled = $state(true)
  let instances = $state(instancesData.sort(() => Math.random() - 0.5))

  const instanceOrderBy = [['status.head', 'status.latency'], ['desc', 'asc']]

  function formatNumber(n: number) {
    return numeral(n).format()
  }

  async function getStatus(instance: Instance) {
    let statusResp: object | undefined;
    let url: string = instance.url;
    const start = performance.now();
    try {
      statusResp = await (await fetch(`${url}/status`)).json()
    } catch (e) {}
    if (!statusResp) {
      url = `https://keyoxide.org/api/3/get/http?url=${encodeURIComponent(url)}&format=text&time=${Date.now()}`
      const indexResp = await (await fetch(url)).text()
      const [ _, from, to ] = indexResp?.match(/Range:\s+(\d{6}) - (\d{6})/)
      statusResp = {  
        bundles: {
          last_bundle: Number(to),
          root_hash: indexResp?.match(/Root: ([a-f0-9]{64})/)[1],
          head_hash: indexResp?.match(/Head: ([a-f0-9]{64})/)[1],
        },
        server: {
          uptime: 1,
        }
      }
    }
    if (statusResp) {
      statusResp.latency = performance.now() - start;
    }
    return statusResp
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
      instance.status.head = status?.bundles?.last_bundle > lastKnownBundle.number
      if (instance.status.head) {
        lastKnownBundle.number = status?.bundles?.last_bundle
        lastKnownBundle.hash = status?.bundles?.head_hash
        lastKnownBundle.time = status?.bundles?.end_time

        if (status?.mempool?.count > lastKnownBundle.mempool) {
          lastKnownBundle.mempool = status?.mempool?.count
          lastKnownBundle.mempoolPercent = Math.round((lastKnownBundle.mempool/100)*100)/100
          lastKnownBundle.etaNext = addSeconds(new Date(), status?.mempool?.eta_next_bundle_seconds)
        }
      }
      lastUpdated = new Date()
    }))
    isUpdating = false
    setTimeout(() => (canRefresh = false), 1000)
  }

  onMount(() => {
    doCheck()

    setTimeout(() => {
      if (autoRefreshEnabled) {
        doCheck()
      }
    }, AUTO_REFRESH_INTERVAL * 1000)
  })
</script>

<main class="w-full mt-10">
  <div class="max-w-4xl mx-auto px-3">

    <header class="flex items-center gap-10 flex-wrap">
      <div class="grow">
        <h1 class="text-3xl linear-text-gradient">plcbundle instances</h1>
      </div>
      <div class="flex items-center gap-6">
        <Switch class="opacity-75" checked={autoRefreshEnabled} onCheckedChange={(x) => autoRefreshEnabled = x.checked} disabled={isUpdating}>
          <Switch.Control className="data-[state=checked]:preset-filled-success-500">
            <Switch.Thumb />
          </Switch.Control>
          <Switch.Label>Auto-refresh ({AUTO_REFRESH_INTERVAL}s)</Switch.Label>
          <Switch.HiddenInput />
        </Switch>
        <button type="button" class="btn btn-sm preset-tonal-primary"  onclick={() => doCheck()} disabled={canRefresh}>Refresh</button>
      </div>      
    </header>

    <div class="flex gap-10 mt-6 grid grid-cols-2">
      <div>
        <h2 class="opacity-75 text-sm">Last known bundle</h2>
        <div>
          <div class="flex items-center gap-5">
            <div class="font-semibold text-3xl">{lastKnownBundle.number}</div>
            <div class="mt-1 font-mono badge preset-outlined-primary-500 text-xs">{lastKnownBundle?.hash?.slice(0, 7)}</div>
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
              <Progress.Circle style="--size: 48px; --thickness: 6px;">
                <Progress.CircleTrack />
                <Progress.CircleRange />
              </Progress.Circle>
              <!--Progress.ValueText class="text-xs opacity-50" /-->
            </Progress>
          </div>
          {#if lastKnownBundle.number > 0}
            <div>
              <div class="font-semibold text-2xl animate-pulse">{lastKnownBundle.number + 1}</div>
              <div>{formatNumber(lastKnownBundle.mempool)} / {formatNumber(BUNDLE_OPS)} <span class="opacity-50">({lastKnownBundle.mempoolPercent}%)</span></div>
              {#if lastKnownBundle.etaNext}
                <div class="mt-2 opacity-50">ETA: {formatDistanceToNow(lastKnownBundle.etaNext)}</div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>      

    <table class="table mt-10">
      <thead>
        <tr>
          <th>endpoint</th>
          <th>status</th>
          <th>last bundle</th>
          <th>mempool</th>          
          <th>head</th>
          <th>root</th>
          <th>version</th>
          <th>latency</th>
        </tr>
      </thead>
      <tbody>
        {#each orderBy(instances, ...instanceOrderBy) as instance}
          <tr>
            <td><a href={instance.url} target="_blank" class="font-semibold">{instance.url.replace("https://", "")}</a></td>
            <td>{#if instance.status?.bundles?.last_bundle === lastKnownBundle.number}✅{:else if instance.status}🔄{:else}⌛{/if}</td>
            <td>{#if instance.status?.bundles?.last_bundle}{instance.status?.bundles?.last_bundle}{/if}</td>
            <td>{#if instance.status?.mempool && instance.status?.bundles?.last_bundle === lastKnownBundle.number}{formatNumber(instance.status?.mempool.count)}{:else if instance.status}<span class="opacity-25">syncing</span>{/if}</td>
            <td><span class="font-mono text-xs">{#if instance.status?.bundles?.head_hash}{instance.status?.bundles?.head_hash.slice(0, 7)}{/if}</span></td>
            <td><span class="font-mono text-xs">{#if instance.status?.bundles?.root_hash}{instance.status?.bundles?.root_hash.slice(0, 7)}{/if}</span></td>
            <td>{#if instance.status?.server?.version}{instance.status?.server?.version}{/if}</td>
            <td class="opacity-50">{#if instance.status?.latency}{Math.round(instance.status?.latency)}ms{/if}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <div class="mt-12 opacity-50">
      <div>
        Last updated: {formatISO9075(lastUpdated)}
      </div>
      <div class="mt-4">
        Source: <a href="https://tangled.org/@tree.fail/plcbundle-watch">https://tangled.org/@tree.fail/plcbundle-watch</a>
      </div>
    </div>
  </div>
</main>

