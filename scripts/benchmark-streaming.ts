// Run with: bun run scripts/benchmark-streaming.ts
// Synthetic reducer/serialization benchmark; this does not measure end-to-end UI latency.
import type { Message } from '../packages/core/src/types/index.ts'
import { groupMessagesByTurn, groupImmutableMessagesByTurn } from '../packages/ui/src/components/chat/turn-utils.ts'
import { recordMessageTextUpdate } from '../packages/core/src/utils/message-text-update.ts'
import { compactTextUpdate } from '../packages/pi-agent-server/src/transport-delta.ts'
function sample(fn: () => void) { const t = performance.now(); fn(); return performance.now() - t }
function percentile(values: number[], p: number) { return values.sort((a,b)=>a-b)[Math.floor((values.length-1)*p)] }
for (const count of [100, 1000, 5000]) {
  const base = Array.from({length:count}, (_, i) => ({id: String(i), role: i%2 ? 'assistant' : 'user', content: 'history '.repeat(20), timestamp:i})) as Message[]
  base.push({id:'stream',role:'assistant',content:'',isPending:true,isStreaming:true,timestamp:count})
  const bench = (incremental: boolean) => {
    let previous = base; const times: number[] = []
    groupImmutableMessagesByTurn(previous,{isSessionProcessing:true})
    for(let i=0;i<250;i++) {
      const elapsed = sample(()=>{
        const next = previous.slice(); next[next.length-1]={...next.at(-1),content:`chunk ${i}`}
        if (incremental) { recordMessageTextUpdate(previous,next,next.length-1); groupImmutableMessagesByTurn(next,{isSessionProcessing:true}) }
        else groupMessagesByTurn(next,{isSessionProcessing:true})
        previous=next
      })
      if(i>=50) times.push(elapsed)
    }
    return percentile(times,.95)
  }
  console.log(JSON.stringify({messages:count,fullGroupingP95Ms:bench(false),incrementalP95Ms:bench(true)}))
}
const partial={content:'x'.repeat(1000000)}
const raw={type:'message_update',message:partial,assistantMessageEvent:{type:'text_delta',delta:'hello',partial}}
console.log(JSON.stringify({rawDeltaBytes:Buffer.byteLength(JSON.stringify(raw)),compactDeltaBytes:Buffer.byteLength(JSON.stringify(compactTextUpdate(raw,42)))}))
