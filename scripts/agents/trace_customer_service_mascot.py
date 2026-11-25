"""
Regenerates components/agents/customer-service-paths.ts from the PNG.

    python3 scripts/agents/trace_customer_service_mascot.py

Needs numpy and Pillow. It sorts every pixel into the mascot's four colours,
splits the shape into parts (raised arm, body, headphone band and cups, eyes,
mouth), traces each outline, smooths it and writes SVG path strings. The arm
is cut from the body along a line from under the left ear cup to the armpit,
so it can wave around CS_ARM_PIVOT. Only needed if the PNG changes.
"""
import json
import numpy as np
from PIL import Image
import os
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','..'))
SRC=os.path.join(ROOT,'public','agents','01-customer-service.png')
OUT=os.path.join(ROOT,'components','agents','customer-service-paths.ts')
PAL={'teal':(21,180,187),'pink':(247,198,193),'gray':(76,87,91),'dark':(0,24,36)}
def load():
    im=np.array(Image.open(SRC).convert('RGBA')).astype(int)
    rgb=im[...,:3]; a=im[...,3]
    names=list(PAL); cols=np.array([PAL[n] for n in names])
    d=((rgb[...,None,:]-cols[None,None])**2).sum(-1)
    lab=np.array(names)[d.argmin(-1)]
    lab[a<128]='none'
    return lab
def label_components(mask):
    # 4-connected labelling, iterative flood fill
    H,W=mask.shape; lab=np.zeros((H,W),int); n=0
    for y,x in zip(*np.nonzero(mask)):
        if lab[y,x]: continue
        n+=1; stack=[(y,x)]; lab[y,x]=n
        while stack:
            cy,cx=stack.pop()
            for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
                ny,nx=cy+dy,cx+dx
                if 0<=ny<H and 0<=nx<W and mask[ny,nx] and not lab[ny,nx]:
                    lab[ny,nx]=n; stack.append((ny,nx))
    return lab,n
def fill_holes(mask):
    outside=~mask; lab,n=label_components(outside)
    border=set(np.unique(np.concatenate([lab[0],lab[-1],lab[:,0],lab[:,-1]])))-{0}
    keep=np.isin(lab,list(border))
    return ~keep
def dilate(mask,r):
    out=mask.copy(); H,W=mask.shape
    for dy in range(-r,r+1):
        for dx in range(-r,r+1):
            if dy*dy+dx*dx>r*r: continue
            s=np.zeros_like(mask)
            ys=slice(max(dy,0),H+min(dy,0)); yd=slice(max(-dy,0),H+min(-dy,0))
            xs=slice(max(dx,0),W+min(dx,0)); xd=slice(max(-dx,0),W+min(-dx,0))
            s[ys,xs]=mask[yd,xd]; out|=s
    return out
def erode(mask,r): return ~dilate(~mask,r)
def trace(mask):
    """Outer boundary of the largest component as a list of (x,y) pixel-corner points (marching squares)."""
    m=np.pad(mask,1).astype(np.uint8)
    H,W=m.shape
    # find start: topmost-leftmost filled pixel
    ys,xs=np.nonzero(m); i=np.lexsort((xs,ys))[0]; y0,x0=ys[i],xs[i]
    # trace boundary edges keeping filled on the right (clockwise in image coords)
    # state: position at corner (x,y), direction
    x,y=x0,y0; d=0  # 0:right,1:down,2:left,3:up ; start along top edge of pixel going right
    pts=[(x,y)]
    dirs=[(1,0),(0,1),(-1,0),(0,-1)]
    def filled(px,py): return 0<=px<W and 0<=py<H and m[py,px]
    start=(x,y,d)
    for _ in range(10**7):
        dx,dy=dirs[d]; x+=dx; y+=dy
        # at corner (x,y) heading d. pixel ahead-left and ahead-right
        if d==0: L=(x,y-1); R=(x,y)
        elif d==1: L=(x,y); R=(x-1,y)
        elif d==2: L=(x-1,y); R=(x-1,y-1)
        else: L=(x-1,y-1); R=(x,y-1)
        fl=filled(*L); fr=filled(*R)
        if fl: d=(d-1)%4      # turn left
        elif fr: pass          # straight
        else: d=(d+1)%4       # turn right
        pts.append((x,y))
        if (x,y,d)==start: break
    return [(px-1,py-1) for px,py in pts]
def rdp(pts,eps):
    pts=np.array(pts,float)
    def rec(a,b):
        if b<=a+1: return [a]
        p,q=pts[a],pts[b]; seg=q-p; L=np.hypot(*seg)
        sub=pts[a+1:b]
        if L==0: dist=np.hypot(*(sub-p).T)
        else: dist=np.abs(seg[0]*(sub[:,1]-p[1])-seg[1]*(sub[:,0]-p[0]))/L
        k=dist.argmax()
        if dist[k]>eps: return rec(a,a+1+k)+rec(a+1+k,b)
        return [a]
    idx=rec(0,len(pts)-1)+[len(pts)-1]
    return pts[idx]
def smooth_path(poly,tension=1.0):
    P=np.array(poly,float)
    if np.allclose(P[0],P[-1]): P=P[:-1]
    n=len(P); s=f'M{P[0][0]:.0f} {P[0][1]:.0f}'
    for i in range(n):
        p0,p1,p2,p3=P[i-1],P[i],P[(i+1)%n],P[(i+2)%n]
        c1=p1+(p2-p0)/6*tension; c2=p2-(p3-p1)/6*tension
        s+=f'C{c1[0]:.0f} {c1[1]:.0f} {c2[0]:.0f} {c2[1]:.0f} {p2[0]:.0f} {p2[1]:.0f}'
    return s+'Z'
def largest(mask):
    lab,n=label_components(mask)
    if n<=1: return mask
    sizes=np.bincount(lab.ravel()); sizes[0]=0
    return lab==sizes.argmax()
def blur(mask,r=2):
    f=mask.astype(float)
    for axis in (0,1):
        c=np.cumsum(np.pad(f,[(r+1,r) if a==axis else (0,0) for a in (0,1)]),axis=axis)
        if axis==0: f=(c[2*r+1:]-c[:-2*r-1])/(2*r+1)
        else: f=(c[:,2*r+1:]-c[:,:-2*r-1])/(2*r+1)
    return f
def clean(mask):
    return largest(blur(blur(mask,2),2)>0.5)
def soften(pts,k=4):
    P=np.array(pts,float)
    if np.allclose(P[0],P[-1]): P=P[:-1]
    out=np.zeros_like(P)
    for s in range(-k,k+1): out+=np.roll(P,s,axis=0)
    out/= (2*k+1)
    return np.vstack([out,out[:1]])
def to_path(mask,eps=0.9,k=4):
    return smooth_path(rdp(soften(trace(clean(mask)),k),eps))

lab=load(); H,W=lab.shape
opaque=lab!='none'; teal=lab=='teal'; pink=lab=='pink'; gray=lab=='gray'; dark=lab=='dark'
yy,xx=np.mgrid[0:H,0:W]
A=np.array([222,440.]); B=np.array([178,566.])
armside=((B[0]-A[0])*(yy-A[1])-(B[1]-A[1])*(xx-A[0]))>0
# which side is the arm? the arm tip (100,410) must be on armside
if not armside[410,100]: armside=~armside
armside&=~((yy<448)&(xx>200))
tealf=fill_holes(teal)
holes=tealf&~teal
hl,hn=label_components(holes)
feats=[]
for i in range(1,hn+1):
    m=hl==i; n=m.sum()
    if n<80: continue
    ys,xs=np.nonzero(m); feats.append(dict(m=m,n=n,cx=xs.mean(),cy=ys.mean(),w=np.ptp(xs)+1,h=np.ptp(ys)+1))
feats.sort(key=lambda f:f['cx'])
for f in feats: print('hole',round(f['cx']),round(f['cy']),f['w'],f['h'],f['n'])
arm_teal=tealf&armside; body_teal=tealf&~armside
P=(212,505)
disk=((xx-P[0])**2+(yy-P[1])**2)<=48**2
arm_inner=arm_teal|(disk&tealf)
inkish=opaque&(dark|teal)
arm_outer=dilate(arm_teal,30)&inkish&dilate(armside,12)
body_outer=dilate(body_teal,30)&inkish&dilate(~armside,12)
pl,pn=label_components(pink); gl,gn=label_components(gray)
pcs=sorted([dict(m=pl==i,n=(pl==i).sum(),cx=np.nonzero(pl==i)[1].mean()) for i in range(1,pn+1) if (pl==i).sum()>300],key=lambda c:-c['n'])
gcs=sorted([dict(m=gl==i,n=(gl==i).sum(),cx=np.nonzero(gl==i)[1].mean()) for i in range(1,gn+1) if (gl==i).sum()>300],key=lambda c:c['cx'])
print('pink comps',[(c['n'],round(c['cx'])) for c in pcs]); print('gray comps',[(c['n'],round(c['cx'])) for c in gcs])
# band = pink comp spanning widest
def span(c): xs=np.nonzero(c['m'])[1]; return np.ptp(xs)
band=max(pcs,key=span); rest=[c for c in pcs if c is not band]; rest.sort(key=lambda c:c['cx'])
pinkL,pinkR=rest[0]['m'],rest[-1]['m']; grayL,grayR=gcs[0]['m'],gcs[-1]['m']
notteal=opaque&~teal
cupL=pinkL|grayL; cupR=pinkR|grayR
cupL_outer=dilate(cupL,28)&notteal; cupR_outer=dilate(cupR,28)&notteal
band_outer=dilate(band['m'],28)&notteal
out={}
def add(k,m,eps=1.4): out[k]=to_path(m,eps)
add('armOuter',arm_outer); add('armInner',arm_inner)
add('bodyOuter',body_outer); add('bodyInner',body_teal)
add('bandOuter',band_outer); add('band',band['m'])
add('cupLOuter',cupL_outer); add('cupLPink',pinkL); add('cupLGray',grayL)
add('cupROuter',cupR_outer); add('cupRPink',pinkR); add('cupRGray',grayR)
eyes=[f for f in feats if abs(f['w']-f['h'])<12]
mouth=[f for f in feats if abs(f['w']-f['h'])>=12]
out['eyes']=[dict(cx=round(f['cx'],1),cy=round(f['cy'],1),rx=round(f['w']/2,1),ry=round(f['h']/2,1)) for f in eyes]
out['mouth']=to_path(mouth[0]['m'],0.6,2)
out['pivotArm']=P
print({k:len(v) for k,v in out.items() if isinstance(v,str)})

keys=['armOuter','armInner','bodyOuter','bodyInner','bandOuter','band','cupLOuter','cupLPink','cupLGray','cupROuter','cupRPink','cupRGray','mouth']
lines=['/**',' * Customer Service mascot, traced from public/agents/01-customer-service.png',' * (900×900) and split into parts that can move on their own.',' * Generated once; edit the art, not these numbers, if the mascot changes.',' * Each part has an outline layer (drawn first) and a fill layer, so parts',' * that overlap merge into one silhouette, as in the PNG.',' */','','export const CS_PATHS = {']
for k in keys: lines.append(f'  {k}:\n    "{out[k]}",')
lines.append('} as const;\n')
e=out['eyes']
lines.append("/** Eye dots: [cx, cy, rx, ry] for the viewer's left and right eye. */")
lines.append('export const CS_EYES = ['+', '.join(f'[{x["cx"]}, {x["cy"]}, {x["rx"]}, {x["ry"]}]' for x in e)+'] as const;\n')
lines.append(f'/** Shoulder of the raised arm, the point it waves around. */\nexport const CS_ARM_PIVOT = [{out["pivotArm"][0]}, {out["pivotArm"][1]}] as const;\n')
open(OUT,'w').write('\n'.join(lines))
print('wrote', OUT)
