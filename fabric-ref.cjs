// The Fabric 7.4.0 build the own engine was checked against (vendored until KB Studio 0.52.2, removed afterwards). The A/B harnesses
// (engine-*-check.cjs) still compare against it: it is read from git history into a temp folder, never into ui/.
//   FABRIC_REF=<commit> picks another commit that still has ui/vendor/fabric*.min.js; FABRIC / FABRIC_EXT use ready-made files.
const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const REF = process.env.FABRIC_REF || 'v0.52.2', dir = path.join(os.tmpdir(), 'kbs-fabric-ref-' + REF);
function get(name, env) {
  if (process.env[env]) return process.env[env];
  const file = path.join(dir, name); if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, cp.execFileSync('git', ['show', REF + ':ui/vendor/' + name], { cwd: __dirname, maxBuffer: 64 << 20 }));
  return file;
}
module.exports = { fabric: () => get('fabric.min.js', 'FABRIC'), extensions: () => get('fabric-extensions.min.js', 'FABRIC_EXT') };
