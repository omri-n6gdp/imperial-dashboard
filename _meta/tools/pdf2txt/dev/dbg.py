import sys, os, statistics
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pdf2txt as P
from pdfminer.pdfinterp import PDFResourceManager, PDFPageInterpreter
from pdfminer.pdfpage import PDFPage
def page_chars(path, pno):
    rm=PDFResourceManager(); dev=P.Agg(rm,laparams=None); it=PDFPageInterpreter(rm,dev)
    for i,pg in enumerate(PDFPage.get_pages(open(path,'rb'))):
        if i+1!=pno: continue
        it.process_page(pg); lt=dev.get_result()
        ch,hr,vr,rot=[],[],[],[]; P.collect(lt,ch,hr,vr,rot)
        return ch,hr,vr,lt
def find_page(path, needle):
    import subprocess
    n=int(subprocess.run(['pdfinfo',path],capture_output=True,text=True).stdout.split('Pages:')[1].split()[0])
    for p in range(1,n+1):
        t=subprocess.run(['pdftotext','-f',str(p),'-l',str(p),path,'-'],capture_output=True,text=True).stdout
        if needle in t: return p
if __name__=='__main__':
    path=sys.argv[1]; pno=int(sys.argv[2]) if sys.argv[2].isdigit() else find_page(path,sys.argv[2]); y0=float(sys.argv[3]); y1=float(sys.argv[4])
    print('page',pno)
    ch,hr,vr,lt=page_chars(path,pno)
    for r in hr:
        if y0<r[2]<y1: print('RULE x %.1f-%.1f y %.1f'%r)
    for c in sorted(ch,key=lambda c:(-c.b,c.x0)):
        if y0<c.b<y1: print('%r x %.1f-%.1f b %.1f s %.1f top %.1f bot %.1f'%(c.t,c.x0,c.x1,c.b,c.s,c.top,c.bot))
