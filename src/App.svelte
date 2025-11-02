<script lang="ts">
  import { onMount } from 'svelte';
  import instancesData from './instances.json';

  type Instance = {
    url: string,
    cors?: boolean,
    status?: object,
    modern?: boolean,
  }

  let lastKnownBundle = $state({
    number: 0,
    hash: null,
  })

  let instances = $state(instancesData)
  let instancesSorted = $derived(instances.sort((a, b) => a.status?.responseTime > b.status?.responseTime ? 1 : -1))

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
      statusResp.responseTime = performance.now() - start;
    }
    return statusResp
  }

  async function doCheck() {
    for (const i of instances) {
      i.status = undefined
    }

    await Promise.all(instances.map(async (instance) => {
      const status = await getStatus(instance)

      if (status?.bundles?.last_bundle > lastKnownBundle.number) {
        lastKnownBundle.number = status?.bundles?.last_bundle
        lastKnownBundle.hash = status?.bundles?.head_hash
      }
      instance.status = status
    }))
  }

  onMount(() => {
    doCheck()
  })
</script>

<main class="w-full mt-10">
  <div class="max-w-4xl mx-auto px-3">

    <header>
      <h1 class="text-3xl">plcbundle instances</h1>
    </header>

    <div class="flex items-center gap-2 mt-10 flex-wrap">
      <div class="grow flex items-center text-lg">
        <div><span class="opacity-50">Last known bundle:</span> <span class="font-semibold">{lastKnownBundle.number}</span> [<span class="font-mono text-base">{lastKnownBundle?.hash?.slice(0, 7)}</span>]</div>
      </div>
      <div class="">
          <button type="button" class="btn btn-sm preset-tonal-primary"  onclick={() => doCheck()}>Refresh</button>
      </div>
    </div>      

    <table class="table mt-4">
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
        {#each instances as instance}
          <tr>
            <td><a href={instance.url} target="_blank" class="font-semibold">{instance.url.replace("https://", "")}</a></td>
            <td>{#if instance.status?.bundles?.last_bundle === lastKnownBundle.number}✅{:else if instance.status}🔄{:else}⌛{/if}</td>
            <td>{#if instance.status?.bundles?.last_bundle}{instance.status?.bundles?.last_bundle}{/if}</td>
            <td>{#if instance.status?.mempool}{instance.status?.mempool.count}{:else if instance.status}<span class="opacity-25">syncing</span>{/if}</td>
            <td><span class="font-mono text-xs">{#if instance.status?.bundles?.head_hash}{instance.status?.bundles?.head_hash.slice(0, 7)}{/if}</span></td>
            <td><span class="font-mono text-xs">{#if instance.status?.bundles?.root_hash}{instance.status?.bundles?.root_hash.slice(0, 7)}{/if}</span></td>
            <td>{#if instance.status?.server?.version}{instance.status?.server?.version}{/if}</td>
            <td class="opacity-50">{#if instance.status?.responseTime}{instance.status?.responseTime}ms{/if}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <div class="mt-12 opacity-50">
      Source: <a href="https://tangled.org/@tree.fail/plcbundle-watch">https://tangled.org/@tree.fail/plcbundle-watch</a>
    </div>
  </div>
</main>

