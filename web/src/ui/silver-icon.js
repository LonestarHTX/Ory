/* A lightbulb cast in liquid silver: the sign that suggestions are waiting.
   The metal is a small studio of drifting softboxes over a silver floor, with
   a faint warm and cool fringe, read off a polished, domed face and cut to the
   bulb's shape by a mask.
   ping() sends one glint across it. It holds still under reduced motion and in
   a hidden tab; without WebGL the bulb is drawn flat in the text colour. */

const FRAGMENT = `precision highp float;
uniform vec2 res;uniform float time,seed,tone,pingT,pingGain;
const float PI=3.14159265,TAU=6.2831853;
float softbox(float th,float centre,float halfWidth,float blur){
 float limit=cos(halfWidth),e=blur*max(sin(halfWidth),.18);
 return smoothstep(limit-e,limit+e,cos(th-centre));}
float hash1(float n){return fract(sin(n)*43758.5453123);}
float noise1(float x){float i=floor(x),f=fract(x);float u=f*f*f*(f*(f*6.-15.)+10.);return mix(hash1(i),hash1(i+1.),u)*2.-1.;}
float fbm1(float x){return noise1(x)*.6+noise1(x*2.13+7.3)*.28+noise1(x*4.7+3.1)*.12;}
float studio(float th,float blur){
 float t=time,flow=.6,coverage=.45;
 float c1=seed+.35+.055*t+1.2*flow*fbm1(t*.11+seed);
 float c2=seed+3.45-.038*t+1.4*flow*fbm1(t*.083+seed+11.);
 float c3=seed+1.95+.024*t+1.6*flow*fbm1(t*.067+seed+23.);
 float w1=coverage*PI*.62*(1.+.30*flow*fbm1(t*.09+5.));
 float w2=coverage*PI*.42*(1.+.35*flow*fbm1(t*.12+9.));
 float w3=coverage*PI*.13*(1.+.45*flow*fbm1(t*.15+13.));
 float s1=.85+.15*fbm1(t*.07+31.),s2=.72+.28*fbm1(t*.05+37.),s3=.55+.45*fbm1(t*.13+41.);
 float a=softbox(th,c1,w1,blur)*s1,b=softbox(th,c2,w2,blur)*s2,c=softbox(th,c3,w3,blur)*s3;
 return 1.-(1.-a)*(1.-b)*(1.-c);}
void main(){
 vec2 uv=gl_FragCoord.xy/res;
 vec2 p=(uv*2.-1.)*vec2(1.,1.15)+vec2(0.,-.18);
 // Liquid: the surface ripples slowly, so the reflections bend as they pass.
 float t=time;
 p+=.11*vec2(fbm1(t*.9+p.y*2.6+seed),fbm1(t*.8+p.x*2.6+seed+5.));
 // A polished dome: the studio is read in the direction each point reflects,
 // and the studio turns round it, so light rolls across the bulb.
 vec3 N=normalize(vec3(p*.95,sqrt(max(1.25-dot(p,p),.06))));
 vec3 R=reflect(vec3(0.,0.,-1.),N);
 float th=atan(R.y,R.x)+R.z*1.1+t*.45;
 float blur=.45,split=.09;
 vec3 lit=vec3(studio(th+split,blur),studio(th,blur),studio(th-split,blur));
 float grey=dot(lit,vec3(.3,.5,.2));
 lit=mix(vec3(grey),lit,mix(.9,.8,tone));
 // On a light sidebar the metal runs darker, so the whole bulb keeps 3:1 against it.
 vec3 low=mix(vec3(.30,.33,.38),vec3(.24,.26,.30),tone);
 vec3 high=mix(vec3(.99,.995,1.),vec3(.74,.76,.80),tone);
 vec3 color=mix(low,high,lit);
 float key=pow(max(dot(N,normalize(vec3(-.36,.56,.75))),0.),6.);
 color+=vec3(.9,.95,1.)*key*.12*(1.-tone*.6);
 color*=.84+.16*N.z;
 // The base's two bands sit under the dome's light; lift them on dark, deepen them on light.
 float base=1.-smoothstep(.12,.34,uv.y);
 color=mix(color,color*.72,base*tone)+vec3(.14)*base*(1.-tone);
 // The glint: a soft band that crosses the bulb once, top left to bottom right.
 float along=dot(uv-.5,normalize(vec2(1.,-1.)));
 float at=mix(-.9,.9,pingT);
 float env=smoothstep(0.,.15,pingT)*(1.-smoothstep(.5,1.,pingT));
 color+=vec3(1.,.97,.92)*pingGain*env*exp(-pow((along-at)/.16,2.))*.55;
 gl_FragColor=vec4(clamp(color,0.,1.),1.);
}`;

// Lucide's lightbulb, with the glass filled so the metal has a face to show.
const BULB = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5Z' fill='black'/><path d='M9 18h6'/><path d='M10 22h4'/></svg>`;
export const BULB_MASK = `url("data:image/svg+xml,${encodeURIComponent(BULB)}")`;

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
const icons = new Set();
let raf = 0;
let requested = 0;
let previous = 0;

function schedule() {
  requested = performance.now();
  raf = requestAnimationFrame(tick);
}

function tick(now) {
  raf = 0;
  if (document.hidden) return (previous = 0);
  const step = previous ? Math.min(now - previous, 100) : 16;
  previous = now;
  let moving = false;
  for (const icon of icons) {
    if (!icon.el.isConnected || !icon.el.offsetWidth) continue;
    // Much quicker than the rim's idle drift: a bulb this small shows little of the studio.
    if (!reduced.matches) icon.clock += (step / 1000) * 1.6;
    if (icon.ping) {
      icon.ping.t += step / icon.ping.duration;
      if (icon.ping.t >= 1 || reduced.matches) icon.ping = null;
    }
    draw(icon);
    if (!reduced.matches) moving = true;
  }
  if (moving) schedule();
  else previous = 0;
}

/**
 * Start the loop if it isn't running. A frame asked for while the page loads
 * in the background can be dropped, so a request that has sat unanswered for a
 * second is made again rather than trusted.
 */
function wake() {
  if (raf && performance.now() - requested < 1000) return;
  if (raf) cancelAnimationFrame(raf);
  schedule();
}

document.addEventListener("visibilitychange", wake);
window.addEventListener("pageshow", wake);
reduced.addEventListener("change", wake);
new MutationObserver(wake).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

function draw(icon) {
  const { gl, at, canvas } = icon;
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  const size = Math.round(icon.size * ratio);
  if (canvas.width !== size) canvas.width = canvas.height = size;
  gl.viewport(0, 0, size, size);
  gl.uniform2f(at.res, size, size);
  gl.uniform1f(at.time, icon.clock);
  gl.uniform1f(at.seed, icon.seed);
  gl.uniform1f(at.tone, document.documentElement.dataset.theme === "light" ? 1 : 0);
  gl.uniform1f(at.pingT, icon.ping ? Math.min(icon.ping.t, 1) : 0);
  gl.uniform1f(at.pingGain, icon.ping ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
  return shader;
}

/** A silver lightbulb `size` pixels square: {el, ping(), destroy()}. */
export function silverBulb(size = 14) {
  const el = document.createElement("span");
  el.className = "silver-bulb";
  el.style.width = el.style.height = `${size}px`;
  el.style.maskImage = el.style.webkitMaskImage = BULB_MASK;
  el.setAttribute("aria-hidden", "true");
  const canvas = document.createElement("canvas");
  let gl;
  try {
    gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true });
    if (!gl) throw Error("no WebGL");
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}"));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(program, "a");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const at = {};
    for (const name of ["res", "time", "seed", "tone", "pingT", "pingGain"]) at[name] = gl.getUniformLocation(program, name);
    const icon = { el, canvas, gl, at, size, clock: 20 + icons.size * 7, seed: icons.size * 2.3, ping: null };
    el.append(canvas);
    icons.add(icon);
    // The loop sleeps while no bulb is visible; showing one (a panel opening,
    // hidden turning off) gives it a size, which wakes the loop again.
    const resize = new ResizeObserver(wake);
    resize.observe(el);
    wake();
    return {
      el,
      ping({ duration = 900 } = {}) {
        icon.ping = { t: 0, duration };
        wake();
      },
      wake,
      destroy() {
        resize.disconnect();
        icons.delete(icon);
        el.remove();
      },
    };
  } catch {
    // No WebGL: the bulb in the text colour, cut by the same mask.
    el.classList.add("is-flat");
    return { el, ping() {}, wake() {}, destroy: () => el.remove() };
  }
}
