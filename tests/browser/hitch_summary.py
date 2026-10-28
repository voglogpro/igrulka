"""Summarize a hitch_hunt report and its optional Chrome CPU sample profile."""
import argparse
from collections import defaultdict
import json
from pathlib import Path

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('report',type=Path)
args=p.parse_args()
r=json.loads(args.report.read_text(encoding='utf8'))
out={'label':r['label'],'frames':r['frameSummary'],'input':r['inputSummary'],'longTasks':len(r['longTasks'])}
out['largestTasks']=[]
for task in sorted(r['longTasks'],key=lambda x:x['ms'],reverse=True)[:25]:
    spans=[s for s in r['spans'] if task['at']-2<=s['at']<=task['at']+task['ms']]
    out['largestTasks'].append({**task,'spans':sorted(spans,key=lambda s:s['ms'],reverse=True)[:6]})
profile=args.report.with_suffix('.cpuprofile')
if profile.exists():
    d=json.loads(profile.read_text(encoding='utf8'))
    nodes={n['id']:n for n in d['nodes']}
    parents={c:n['id'] for n in d['nodes'] for c in n.get('children',[])}
    exclusive=defaultdict(float);inclusive=defaultdict(float)
    for sample,delta in zip(d.get('samples',[]),d.get('timeDeltas',[])):
        ms=delta/1000;exclusive[sample]+=ms
        current=sample
        while current in nodes:
            inclusive[current]+=ms
            current=parents.get(current)
    def describe(node,ms):
        f=nodes[node]['callFrame']
        return {'name':f.get('functionName') or '(anonymous)','url':f.get('url'),'line':f.get('lineNumber',-1)+1,'ms':round(ms,3)}
    out['cpuSelf']=sorted([describe(n,ms) for n,ms in exclusive.items()],key=lambda x:x['ms'],reverse=True)[:60]
    out['cpuInclusive']=sorted([describe(n,ms) for n,ms in inclusive.items() if nodes[n]['callFrame'].get('url')],key=lambda x:x['ms'],reverse=True)[:50]
target=args.report.with_name(args.report.stem+'-summary.json')
target.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8')
trace=args.report.with_name(args.report.stem+'.trace.json')
if trace.exists():
    events=json.loads(trace.read_text(encoding='utf8')).get('traceEvents',[])
    anchor=next((e for e in events if e.get('name')=='skyfront-hitch-start'),None)
    if anchor:
        threads={(e['pid'],e['tid']):e.get('args',{}).get('name') for e in events if e.get('name')=='thread_name'}
        tasks=[{'name':e['name'],'at':round((e['ts']-anchor['ts'])/1000,3),'ms':round(e['dur']/1000,3),
                'cpuMs':round(e['tdur']/1000,3) if 'tdur'in e else None,'thread':threads.get((e['pid'],e['tid'])),
                'main':e['pid']==anchor['pid'] and e['tid']==anchor['tid'],'args':e.get('args')}
               for e in events if e.get('ph')=='X' and e.get('dur',0)>=20000 and e.get('ts',0)>=anchor['ts']]
        out['chromeTasks']=sorted(tasks,key=lambda x:x['ms'],reverse=True)[:100]
        # RAF intervals also contain time outside the application's callbacks.
        # Report CPU time separately: elapsed duration alone cannot attribute a
        # driver wait or an unscheduled browser process to expensive JavaScript.
        callbacks=[e for e in events if e.get('ph')=='X' and e.get('name')=='FireAnimationFrame'
                   and e.get('pid')==anchor['pid'] and e.get('tid')==anchor['tid']]
        out['frameGapAttribution']=[]
        for frame in sorted(r['frames'],key=lambda x:x['ms'],reverse=True)[:20]:
            start=frame['at']-frame['ms'];end=frame['at']
            included=[e for e in callbacks if start<=(e['ts']-anchor['ts'])/1000<=end]
            out['frameGapAttribution'].append({'phase':frame['phase'],'at':frame['at'],'gapMs':frame['ms'],
                'callbackWallMs':sum(e.get('dur',0) for e in included)/1000,
                'callbackCpuMs':sum(e.get('tdur',0) for e in included)/1000})
        out['garbageCollections']=sorted([{'name':e['name'],'at':(e['ts']-anchor['ts'])/1000,
            'wallMs':e.get('dur',0)/1000,'cpuMs':e.get('tdur',0)/1000}
            for e in events if e.get('ph')=='X' and e.get('name') in ['MinorGC','MajorGC']
            and e.get('pid')==anchor['pid'] and e.get('tid')==anchor['tid'] and e['ts']>=anchor['ts']],
            key=lambda x:x['wallMs'],reverse=True)[:20]
        target.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'summary':str(target),'largestTasks':out['largestTasks'][:5],'cpuSelf':out.get('cpuSelf',[])[:25]},ensure_ascii=True))
