import dbg,os,sys,pdf2txt as P
ch,hr,vr,lt=dbg.page_chars(sys.argv[1],int(sys.argv[2]))
seen=set()
for c in ch:
    if c.t in sys.argv[3]:
        k=(c.t,P._ff.basename(c.font),c.cid)
        if k in seen: continue
        seen.add(k); print(k, P._ff.font_names(c.font).get(c.cid), type(c.font).__name__, getattr(c.font,'unicode_map',None) is not None, round(c.s,1), round(c.top-c.bot,1), c.big)
