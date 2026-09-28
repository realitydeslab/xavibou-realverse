// Paste into the page console (or run via DevTools automation) with
// tools/capture_server.py running. Renders deterministic 1920x1080 frames
// and POSTs them to reference/renders/ for tools/compare.py.
//
//   await __series('v2', [8, 14, 20, 26], [50, 96])

(() => {
  const S = window.__study;
  const r = S.renderer;
  r.setAnimationLoop(null);
  S.applyTheme('overcast');
  S.controls.autoRotate = false;

  window.__capture = async (name) => {
    r.setPixelRatio(1);
    r.setSize(1920, 1080, false);
    S.camera.aspect = 16 / 9;
    S.camera.updateProjectionMatrix();
    r.render(S.scene, S.camera);
    const blob = await new Promise((res) => r.domElement.toBlob(res, 'image/png'));
    const resp = await fetch(`http://127.0.0.1:5174/${name}.png`, { method: 'POST', body: blob });
    return resp.status;
  };

  window.__series = async (tag, times, lengths) => {
    S.reset();
    S.state.time = 0;
    S.state.frame = 0;
    let t = 0;
    const out = [];
    for (const T of times) {
      await S.advance(T - t);
      t = T;
      for (const L of lengths) {
        S.trails.uniforms.length.value = L;
        out.push(await window.__capture(`${tag}_t${T}_L${L}`));
      }
    }
    return out;
  };
})();
