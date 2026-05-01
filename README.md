# blockgpt-link
npm install @abandonware/bluetooth-hci-socket
在mac系统上会报错，它只支持以下操作系统：Linux、Android、FreeBSD 和 Windows。
删除package.json里   "dependencies": "@abandonware/bluetooth-hci-socket": "^0.5.3-12",


```bash
npm install
npm run fetch
npm start
```

If you work on windows and want to use BLE connection check this instructions: [https://github.com/noble/noble](https://github.com/noble/noble)

BlockGPT Link provides local hardware connectivity and transport services for the BlockGPT desktop and web experience.

关于tools下载
```js
const path = require('path');
const os = require('os');
const fs = require('fs');
const util = require('util'); // 用于 promisify fs.copyFile

const sourceDir = '/Users/luoan/Downloads'; // 本地下载文件的位置
const outputdir = path.resolve('./tools');
const leaveZipped = false;

// 解析命令行参数
const parseArgs = function () {
    const scriptArgs = process.argv.slice(2); // remove `node` and `this-script.js`
    let arch = null;

    for (const arg of scriptArgs) {
        const archSplit = arg.split(/--arch(\s+|=)/);
        if (archSplit.length === 3) {
            arch = archSplit[2];
        }
    }
    return arch;
};

const arch = parseArgs() || os.arch();

const filterAsset = fileName => (fileName.indexOf(os.platform()) >= 0) &&
    (fileName.indexOf(arch) >= 0);

// 创建输出目录
if (!fs.existsSync(outputdir)) {
    fs.mkdirSync(outputdir, {recursive: true});
}

// 异步复制文件的工具函数
const copyFile = util.promisify(fs.copyFile);

// 从本地目录复制符合条件的文件
fs.readdir(sourceDir, (err, files) => {
    if (err) {
        console.error('Error reading source directory:', err);
        return;
    }

    // 过滤符合条件的文件（根据平台和架构）
    const filteredFiles = files.filter(filterAsset);

    if (filteredFiles.length === 0) {
        console.log('No matching files found for this platform and architecture.');
        return;
    }

    // 复制文件到目标目录
    Promise.all(filteredFiles.map(file => {
        const src = path.join(sourceDir, file);
        const dest = path.join(outputdir, file);
        return copyFile(src, dest);
    }))
    .then(() => {
        console.log('Tools copied successfully to', outputdir);
    })
    .catch(err => {
        console.error('Error copying files:', err);
    });
});
```
