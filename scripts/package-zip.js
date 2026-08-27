const fs=require('fs');
const path=require('path');
const { execSync } = require('child_process');

const outDir = path.join(__dirname, '..', 'out');
const pkg = require(path.join(__dirname,'..','package.json'));

// find the unpacked dir (electron-builder --win dir produces win-unpacked)
const candidates = fs.readdirSync(outDir, {withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
const appDir = candidates.find(n=> n.includes('unpacked')) || candidates.find(n=> fs.existsSync(path.join(outDir,n,'Ideogram4Editor.exe'))) || candidates[0];
if(!appDir){
  console.error('No app dir found in out/. Build first: npm run dist');
  process.exit(1);
}
const src = path.join(outDir, appDir);
const zipName = `Ideogram4Editor-${pkg.version}-portable-win-x64.zip`;
const zipPath = path.join(outDir, zipName);

console.log('Zipping', src, '->', zipPath);
try{ fs.unlinkSync(zipPath);}catch{}
if(process.platform==='win32'){
  // use powershell Compress-Archive
  execSync(`powershell -Command "Compress-Archive -Path '${src}\\*' -DestinationPath '${zipPath}' -Force"`, {stdio:'inherit'});
} else {
  execSync(`zip -r "${zipPath}" "${src}"`, {stdio:'inherit'});
}
console.log('Done:', zipPath, ((fs.statSync(zipPath).size/1024/1024).toFixed(1)+' MB'));
