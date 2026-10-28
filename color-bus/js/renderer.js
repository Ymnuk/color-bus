// ============================================================
// WebGPU instanced renderer. Each mesh gets its own pipeline &
// index/vertex buffers; instances are streamed into one big
// per-frame buffer, grouped by mesh (one draw call per mesh).
// Instance layout (28 floats): mat4(16) + rgba(4) + kind(1) + pad(3) + uvRect(4)
// ============================================================
import { WGSL } from './shaders.js';

class MeshBuilder {
  constructor(){ this.pos=[]; this.nrm=[]; this.idx=[]; }
  get vcount(){ return this.pos.length/3; }
  tri(a,b,c){ this.idx.push(a,b,c); }
  quad(p0,p1,p2,p3,n){
    const i=this.vcount;
    for(const p of [p0,p1,p2,p3]){ this.pos.push(p[0],p[1],p[2]); this.nrm.push(n[0],n[1],n[2]); }
    this.idx.push(i,i+1,i+2, i,i+2,i+3);
  }
  build(){
    const n=this.pos.length/3;
    const out=new Float32Array(n*6);
    for(let i=0;i<n;i++){ out[i*6]=this.pos[i*3]; out[i*6+1]=this.pos[i*3+1]; out[i*6+2]=this.pos[i*3+2];
      out[i*6+3]=this.nrm[i*3]; out[i*6+4]=this.nrm[i*3+1]; out[i*6+5]=this.nrm[i*3+2]; }
    return { vertices:out, indices:new Uint16Array(this.idx) };
  }
}

const FPI = 28; // floats per instance

export class Renderer {
  static async create(canvas){
    if(!('gpu' in navigator)) throw new Error('WebGPU not available');
    const adapter = await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
    if(!adapter) throw new Error('No GPU adapter');
    const device = await adapter.requestDevice();
    const ctx = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({device, format, alphaMode:'opaque'});
    return new Renderer(device, ctx, format);
  }

  constructor(device, ctx, format){
    this.device = device; this.ctx = ctx; this.format = format;
    this.meshes = new Map();
    this.maxInstances = 6000;

    const mod = device.createShaderModule({code: WGSL});
    // uniform layout: proj(64) view(64) lightDir(16) ambient(16) camPos(16) time(16) = 176B
    this.uniformBuf = device.createBuffer({
      size: 176,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.uniformData = new Float32Array(44);

    this.instBuf = device.createBuffer({
      size: this.maxInstances * FPI * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    this.bgPipeline = device.createRenderPipeline({
      layout:'auto',
      vertex:{module:mod, entryPoint:'vs_bg'},
      fragment:{module:mod, entryPoint:'fs_bg', targets:[{format}]},
      primitive:{topology:'triangle-list'},
    });

    const bgl = device.createBindGroupLayout({entries:[
      {binding:0, visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,
       buffer:{type:'uniform'}},
    ]});
    this.bindGroup = device.createBindGroup({layout:bgl, entries:[
      {binding:0, resource:{buffer:this.uniformBuf}},
    ]});
    this.bgl = bgl;
    this.shaderMod = mod;

    this.digitBG = null;
    this.depthTex = null; this.depthSize=[0,0];
  }

  setDigitAtlas(bitmap){
    const device=this.device;
    const tex = device.createTexture({
      size:[bitmap.width, bitmap.height],
      format:'rgba8unorm',
      usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({source:bitmap}, {texture:tex}, [bitmap.width, bitmap.height]);
    const sampler = device.createSampler({magFilter:'linear', minFilter:'linear'});
    const layout = device.createBindGroupLayout({entries:[
      {binding:0, visibility:GPUShaderStage.FRAGMENT, texture:{sampleType:'float', viewDimension:'2d'}},
      {binding:1, visibility:GPUShaderStage.FRAGMENT, sampler:{type:'filtering'}},
    ]});
    this.digitBGL = layout;
    this.digitBG = device.createBindGroup({layout, entries:[
      {binding:0, resource:tex.createView()},
      {binding:1, resource:sampler},
    ]});
  }

  makeQuadMesh(w,h){
    const b=new MeshBuilder();
    b.quad([-w/2,-h/2,0],[w/2,-h/2,0],[w/2,h/2,0],[-w/2,h/2,0],[0,0,1]);
    return b.build();
  }

  registerMesh(name, mesh){
    const device=this.device;
    const vb = device.createBuffer({
      size: Math.max(mesh.vertices.byteLength, 16),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vb, 0, mesh.vertices);
    const ib = device.createBuffer({
      size: Math.max(mesh.indices.byteLength, 4),
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(ib, 0, mesh.indices);

    const entries=[this.bgl];
    if(this.digitBGL) entries.push(this.digitBGL);
    const pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({bindGroupLayouts:entries}),
      vertex:{module:this.shaderMod, entryPoint:'vs_main', buffers:[
        { arrayStride:24, attributes:[
          {shaderLocation:0, offset:0,  format:'float32x3'},
          {shaderLocation:1, offset:12, format:'float32x3'},
        ]},
        { arrayStride: FPI*4, stepMode:'instance', attributes:[
          {shaderLocation:6, offset:0,  format:'float32x4'},
          {shaderLocation:7, offset:16, format:'float32x4'},
          {shaderLocation:8, offset:32, format:'float32x4'},
          {shaderLocation:9, offset:48, format:'float32x4'},
          {shaderLocation:10,offset:64, format:'float32x4'},
          {shaderLocation:11,offset:80, format:'float32'},
          {shaderLocation:12,offset:96, format:'float32x4'},
        ]},
      ]},
      fragment:{module:this.shaderMod, entryPoint:'fs_main', targets:[
        {format:this.format, blend:{
          color:{srcFactor:'src-alpha', dstFactor:'one-minus-src-alpha'},
          alpha:{srcFactor:'one', dstFactor:'one-minus-src-alpha'}}}]},
      primitive:{topology:'triangle-list', cullMode:'none'},
      depthStencil:{depthWriteEnabled:true, depthCompare:'less', format:'depth24plus'},
    });
    this.meshes.set(name, {vb, ib, count:mesh.indices.length, pipeline});
  }

  ensureDepth(w,h){
    if(this.depthTex && this.depthSize[0]===w && this.depthSize[1]===h) return;
    this.depthTex?.destroy();
    this.depthTex = this.device.createTexture({
      size:[w,h], format:'depth24plus', usage:GPUTextureUsage.RENDER_ATTACHMENT});
    this.depthSize=[w,h];
  }

  _bgVB(){
    if(!this.__bgVB){
      this.__bgVB=this.device.createBuffer({size:48,usage:GPUBufferUsage.VERTEX});
    }
    return this.__bgVB;
  }

  submit(camera, drawList){
    // drawList items: {mesh, m(16 numbers), color:[r,g,b,a], kind:0|1|2, uv:[x0,y0,x1,y1], order:number}
    drawList.sort((a,b)=>a.order-b.order);
    if(drawList.length>this.maxInstances) drawList.length=this.maxInstances;

    const buckets = new Map();
    for(let i=0;i<drawList.length;i++){
      const d=drawList[i];
      let arr=buckets.get(d.mesh); if(!arr){arr=[];buckets.set(d.mesh,arr);}
      arr.push(i);
    }
    const data = new Float32Array(drawList.length*FPI);
    const groups=[];
    let p=0;
    for(const [mesh,idxs] of buckets){
      groups.push([mesh, idxs.length, p/FPI]);
      for(const i of idxs){
        const d=drawList[i];
        const m=d.m;
        for(let k=0;k<16;k++) data[p+k]=m[k];
        data[p+16]=d.color[0]; data[p+17]=d.color[1]; data[p+18]=d.color[2]; data[p+19]=d.color[3];
        data[p+20]=d.kind||0; data[p+21]=0; data[p+22]=0; data[p+23]=0;
        const uv=d.uv||[0,0,1,1];
        data[p+24]=uv[0]; data[p+25]=uv[1]; data[p+26]=uv[2]; data[p+27]=uv[3];
        p+=FPI;
      }
    }
    this.device.queue.writeBuffer(this.instBuf, 0, data, 0, p);

    const u=this.uniformData; let o=0;
    u.set(camera.proj,o); o+=16;
    u.set(camera.view,o); o+=16;
    u.set(camera.lightDir,o); o+=4;
    u.set(camera.ambient,o); o+=4;
    u.set(camera.camPos,o); o+=4;
    u[o]=camera.time; u[o+1]=0;u[o+2]=0;u[o+3]=0;
    this.device.queue.writeBuffer(this.uniformBuf, 0, u, 0, 44);

    const w=this.ctx.canvas.width, h=this.ctx.canvas.height;
    this.ensureDepth(w,h);

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments:[{
        view:this.ctx.getCurrentTexture().createView(),
        clearValue:{r:0.75,g:0.88,b:0.98,a:1}, loadOp:'clear', storeOp:'store'}],
      depthStencilAttachment:{
        view:this.depthTex.createView(),
        depthClearValue:1.0, depthLoadOp:'clear', depthStoreOp:'store'},
    });
    pass.setPipeline(this.bgPipeline);
    pass.setVertexBuffer(0, this._bgVB(), 0, 0);
    pass.draw(3);
    for(const [mesh,instCount,baseInst] of groups){
      const M=this.meshes.get(mesh);
      if(!M || instCount===0) continue;
      pass.setPipeline(M.pipeline);
      pass.setBindGroup(0,this.bindGroup);
      if(this.digitBG) pass.setBindGroup(1,this.digitBG);
      pass.setVertexBuffer(0,M.vb);
      pass.setVertexBuffer(1,this.instBuf);
      pass.setIndexBuffer(M.ib,'uint16');
      pass.drawIndexed(M.count, instCount, 0, 0, baseInst);
    }
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }
}
