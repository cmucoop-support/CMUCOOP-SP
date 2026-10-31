(function () {
  'use strict';
  function canvas(width,height) { const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(width)); c.height=Math.max(1,Math.round(height)); return c; }
  function integral(values,w,h) {
    const out=new Float64Array((w+1)*(h+1));
    for(let y=0;y<h;y++) { let row=0; for(let x=0;x<w;x++) { row+=values[y*w+x]; out[(y+1)*(w+1)+x+1]=out[y*(w+1)+x+1]+row; } }
    return out;
  }
  function sum(a,w,x0,y0,x1,y1) { const s=w+1; return a[y1*s+x1]-a[y0*s+x1]-a[y1*s+x0]+a[y0*s+x0]; }
  function regions(source) {
    const scale=Math.min(1,900/Math.max(source.width,source.height)), c=canvas(source.width*scale,source.height*scale),ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(source,0,0,c.width,c.height);
    const w=c.width,h=c.height,pixels=ctx.getImageData(0,0,w,h).data,gray=new Uint8Array(w*h),mask=new Uint8Array(w*h);
    for(let i=0;i<gray.length;i++) gray[i]=(pixels[4*i]*77+pixels[4*i+1]*150+pixels[4*i+2]*29)>>8;
    const means=integral(gray,w,h),r=7;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      const x0=Math.max(0,x-r),y0=Math.max(0,y-r),x1=Math.min(w,x+r+1),y1=Math.min(h,y+r+1),i=y*w+x;
      const mean=sum(means,w,x0,y0,x1,y1)/((x1-x0)*(y1-y0));
      if(mean>110 && gray[i]<mean-16 && Math.max(pixels[4*i],pixels[4*i+1],pixels[4*i+2])-Math.min(pixels[4*i],pixels[4*i+1],pixels[4*i+2])<100) mask[i]=1;
    }
    const counts=integral(mask,w,h),joined=new Uint8Array(w*h),rx=6,ry=2;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) joined[y*w+x]=sum(counts,w,Math.max(0,x-rx),Math.max(0,y-ry),Math.min(w,x+rx+1),Math.min(h,y+ry+1))>0 ? 1:0;
    const queue=new Int32Array(w*h),out=[];
    for(let i=0;i<joined.length;i++) {
      if(!joined[i]) continue;
      let head=0,tail=1,x0=i%w,x1=x0,y0=Math.floor(i/w),y1=y0;queue[0]=i;joined[i]=0;
      while(head<tail) {
        const k=queue[head++],x=k%w,y=Math.floor(k/w);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
        if(x>0 && joined[k-1]) { joined[k-1]=0;queue[tail++]=k-1; }
        if(x<w-1 && joined[k+1]) { joined[k+1]=0;queue[tail++]=k+1; }
        if(y>0 && joined[k-w]) { joined[k-w]=0;queue[tail++]=k-w; }
        if(y<h-1 && joined[k+w]) { joined[k+w]=0;queue[tail++]=k+w; }
      }
      const bw=x1-x0+1-2*rx,bh=y1-y0+1-2*ry,ratio=bw/bh;
      if(bw<45 || bh<7 || bh>100 || ratio<2.2 || ratio>28) continue;
      const ink=sum(counts,w,Math.max(0,x0+rx),Math.max(0,y0+ry),Math.min(w,x1-rx+1),Math.min(h,y1-ry+1));
      if(ink/(bw*bh)<.06 || ink/(bw*bh)>.65) continue;
      const pad=Math.max(4,bh*.25),x=Math.max(0,x0+rx-pad),y=Math.max(0,y0+ry-pad),right=Math.min(w,x1-rx+pad+1),bottom=Math.min(h,y1-ry+pad+1);
      const score=1-Math.min(1,Math.abs(ratio-7)/20)+(bh>=12?.4:0)+(ink/(bw*bh)>.12?.3:0);
      out.push({x:x/scale,y:y/scale,w:(right-x)/scale,h:(bottom-y)/scale,score});
    }
    return out.sort((a,b)=>b.score-a.score).slice(0,18);
  }
  function prepare(source,rect,mode='original',rotation=0) {
    const r=rect||{x:0,y:0,w:source.width,h:source.height};
    const scale=Math.min(3,2000/Math.max(r.w,r.h)),border=14,w=Math.round(r.w*scale),h=Math.round(r.h*scale);
    const c=canvas((rotation%180?h:w)+border*2,(rotation%180?w:h)+border*2),ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.translate(c.width/2,c.height/2);ctx.rotate(rotation*Math.PI/180);ctx.drawImage(source,r.x,r.y,r.w,r.h,-w/2,-h/2,w,h);
    if(mode==='original') return c;
    const data=ctx.getImageData(0,0,c.width,c.height),gray=new Uint8Array(c.width*c.height),hist=new Uint32Array(256);
    for(let i=0;i<gray.length;i++) { gray[i]=(data.data[4*i]*77+data.data[4*i+1]*150+data.data[4*i+2]*29)>>8;hist[gray[i]]++; }
    let low=0,high=255,count=0;
    while(low<254 && (count+=hist[low])<gray.length*.02) low++;
    count=0;while(high>low+1 && (count+=hist[high])<gray.length*.02) high--;
    const avg=mode==='binary'?integral(gray,c.width,c.height):null,rad=15;
    for(let y=0;y<c.height;y++) for(let x=0;x<c.width;x++) {
      const i=y*c.width+x;
      let value=Math.max(0,Math.min(255,(gray[i]-low)*255/Math.max(30,high-low)));
      if(avg) { const x0=Math.max(0,x-rad),x1=Math.min(c.width,x+rad+1),y0=Math.max(0,y-rad),y1=Math.min(c.height,y+rad+1);value=gray[i]<sum(avg,c.width,x0,y0,x1,y1)/((x1-x0)*(y1-y0))-9?0:255; }
      data.data[4*i]=data.data[4*i+1]=data.data[4*i+2]=value;data.data[4*i+3]=255;
    }
    ctx.putImageData(data,0,0);return c;
  }
  window.CMUExpiryImage={regions,prepare};
}());
