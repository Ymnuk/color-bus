// Minimal linear algebra for WebGPU rendering (column-major mat4 arrays)
export const M4 = {
  create() {
    return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  },
  identity(o){ o.set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); return o; },
  perspective(out, fovy, aspect, near, far){
    const f = 1.0 / Math.tan(fovy/2), nf = 1/(near-far);
    out[0]=f/aspect; out[1]=0; out[2]=0; out[3]=0;
    out[4]=0; out[5]=f; out[6]=0; out[7]=0;
    out[8]=0; out[9]=0; out[10]=(far+near)*nf; out[11]=-1;
    out[12]=0; out[13]=0; out[14]=2*far*near*nf; out[15]=0;
    return out;
  },
  lookAt(out, eye, center, up){
    let z0=eye[0]-center[0], z1=eye[1]-center[1], z2=eye[2]-center[2];
    let len=1/Math.hypot(z0,z1,z2); z0*=len; z1*=len; z2*=len;
    let x0=up[1]*z2-up[2]*z1, x1=up[2]*z0-up[0]*z2, x2=up[0]*z1-up[1]*z0;
    len=Math.hypot(x0,x1,x2); if(len){len=1/len; x0*=len;x1*=len;x2*=len;} else {x0=1;x1=0;x2=0;}
    const y0=z1*x2-z2*x1, y1=z2*x0-z0*x2, y2=z0*x1-z1*x0;
    out[0]=x0; out[1]=y0; out[2]=z0; out[3]=0;
    out[4]=x1; out[5]=y1; out[6]=z1; out[7]=0;
    out[8]=x2; out[9]=y2; out[10]=z2; out[11]=0;
    out[12]=-(x0*eye[0]+x1*eye[1]+x2*eye[2]);
    out[13]=-(y0*eye[0]+y1*eye[1]+y2*eye[2]);
    out[14]=-(z0*eye[0]+z1*eye[1]+z2*eye[2]);
    out[15]=1;
    return out;
  },
  multiply(out,a,b){
    for(let c=0;c<4;c++){
      const b0=b[c*4],b1=b[c*4+1],b2=b[c*4+2],b3=b[c*4+3];
      out[c*4]  =a[0]*b0+a[4]*b1+a[8]*b2+a[12]*b3;
      out[c*4+1]=a[1]*b0+a[5]*b1+a[9]*b2+a[13]*b3;
      out[c*4+2]=a[2]*b0+a[6]*b1+a[10]*b2+a[14]*b3;
      out[c*4+3]=a[3]*b0+a[7]*b1+a[11]*b2+a[15]*b3;
    }
    return out;
  },
  // TRS with rotation order Y then X then Z (local axes)
  compose(out, pos, rot, scale){
    const cx=Math.cos(rot[0]), sx=Math.sin(rot[0]);
    const cy=Math.cos(rot[1]), sy=Math.sin(rot[1]);
    const cz=Math.cos(rot[2]), sz=Math.sin(rot[2]);
    // R = Ry * Rx * Rz
    const m00=cy*cz+sy*sx*sz, m01=-cy*sz+sy*sx*cz, m02=sy*cx;
    const m10=cx*sz,           m11=cx*cz,          m12=-sx;
    const m20=-sy*cz+cy*sx*sz, m21=sy*sz+cy*sx*cz, m22=cy*cx;
    out[0]=m00*scale[0]; out[1]=m10*scale[0]; out[2]=m20*scale[0]; out[3]=0;
    out[4]=m01*scale[1]; out[5]=m11*scale[1]; out[6]=m21*scale[1]; out[7]=0;
    out[8]=m02*scale[2]; out[9]=m12*scale[2]; out[10]=m22*scale[2]; out[11]=0;
    out[12]=pos[0]; out[13]=pos[1]; out[14]=pos[2]; out[15]=1;
    return out;
  },
  invert(out,a){
    const a00=a[0],a01=a[1],a02=a[2],a03=a[3],a10=a[4],a11=a[5],a12=a[6],a13=a[7],
          a20=a[8],a21=a[9],a22=a[10],a23=a[11],a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    const b00=a00*a11-a01*a10,b01=a00*a12-a02*a10,b02=a00*a13-a03*a10,b03=a01*a12-a02*a11,
          b04=a01*a13-a03*a11,b05=a02*a13-a03*a12,b06=a20*a31-a21*a30,b07=a20*a32-a22*a30,
          b08=a20*a33-a23*a30,b09=a21*a32-a22*a31,b10=a21*a33-a23*a31,b11=a22*a33-a23*a32;
    let det=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
    if(!det) return null; det=1/det;
    out[0]=(a11*b11-a12*b10+a13*b09)*det; out[1]=(a02*b10-a01*b11-a03*b09)*det;
    out[2]=(a31*b05-a32*b04+a33*b03)*det; out[3]=(a22*b04-a21*b05-a23*b03)*det;
    out[4]=(a12*b08-a10*b11-a13*b07)*det; out[5]=(a00*b11-a02*b08+a03*b07)*det;
    out[6]=(a32*b02-a30*b05-a33*b01)*det; out[7]=(a20*b05-a22*b02+a23*b01)*det;
    out[8]=(a10*b10-a11*b08+a13*b06)*det; out[9]=(a01*b08-a00*b10-a03*b06)*det;
    out[10]=(a30*b04-a31*b02+a33*b00)*det; out[11]=(a21*b02-a20*b04-a23*b00)*det;
    out[12]=(a11*b07-a10*b09-a12*b06)*det; out[13]=(a00*b09-a01*b07+a02*b06)*det;
    out[14]=(a31*b01-a30*b03-a32*b00)*det; out[15]=(a20*b03-a21*b01+a22*b00)*det;
    return out;
  }
};

export function transformPoint(m, p){
  const w = m[3]*p[0]+m[7]*p[1]+m[11]*p[2]+m[15];
  return [
    (m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12])/w,
    (m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13])/w,
    (m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14])/w
  ];
}

export const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
export const lerp=(a,b,t)=>a+(b-a)*t;
export const rand=(a,b)=>a+Math.random()*(b-a);
export const randInt=(a,b)=>Math.floor(rand(a,b+1));
