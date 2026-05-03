const fs = require('fs');
const path = require('path');
const ansi = require('ansi-string');

const DEFAULT_REMOTE_ROOT = '/tmp/blockgpt-remote-linux';
const DEFAULT_PYTHON_PATH = 'python3';

const shellEscape = value => `'${String(value).replace(/'/g, `'\\''`)}'`;

const statSafe = filePath => {
    try {
        return fs.statSync(filePath);
    } catch (e) {
        return null;
    }
};

const collectLibraryFiles = libraryRoots => {
    const results = [];
    const walk = currentPath => {
        const fileStat = statSafe(currentPath);
        if (!fileStat) return;
        if (fileStat.isDirectory()) {
            fs.readdirSync(currentPath).forEach(entry => {
                walk(path.join(currentPath, entry));
            });
            return;
        }
        if (fileStat.isFile()) {
            results.push(currentPath);
        }
    };

    (libraryRoots || []).forEach(root => walk(root));
    return results;
};

class RemoteLinux {
    constructor (client, target, config, sendstd, sendRemoteRequest) {
        this._client = client;
        this._target = target || {};
        this._config = config || {};
        this._sendstd = sendstd;
        this._sendRemoteRequest = sendRemoteRequest;

        this._abort = false;
        this._activeChannel = null;
    }

    abortUpload () {
        this._abort = true;
        if (this._activeChannel) {
            try {
                if (typeof this._activeChannel.signal === 'function') {
                    this._activeChannel.signal('INT');
                }
            } catch (e) {
                // ignore signal errors and continue closing channel
            }
            try {
                this._activeChannel.close();
            } catch (e) {
                // ignore close errors
            }
        }
    }

    async upload (code) {
        this._sendRemoteRequest('setUploadAbortEnabled', true);

        const deviceId = this._config.deviceId || 'remote-linux';
        const remoteRoot = this._target.workdir || `${DEFAULT_REMOTE_ROOT}/${deviceId}`;
        const remoteMainPath = `${remoteRoot}/main.py`;
        const pythonPath = this._target.pythonPath || DEFAULT_PYTHON_PATH;

        this._sendstd(`${ansi.clear}Preparing remote workspace...\n`);
        await this._execSimple(`mkdir -p ${shellEscape(remoteRoot)}`);

        if (this._abort) return 'Aborted';

        this._sendstd(`${ansi.clear}Uploading main.py to ${remoteRoot}\n`);
        await this._writeRemoteFile(remoteMainPath, code);

        const libraryFiles = collectLibraryFiles(this._config.library);
        if (libraryFiles.length > 0) {
            this._sendstd(`${ansi.clear}Uploading ${libraryFiles.length} library file(s)...\n`);
        }

        for (const filePath of libraryFiles) {
            if (this._abort) return 'Aborted';
            const fileName = path.basename(filePath);
            const remoteFilePath = `${remoteRoot}/${fileName}`;
            this._sendstd(`${ansi.clear}Uploading ${fileName}\n`);
            await this._writeRemoteFile(remoteFilePath, fs.readFileSync(filePath));
        }

        if (this._abort) return 'Aborted';

        this._sendstd(`${ansi.clear}Running ${pythonPath} main.py\n`);
        const exitCode = await this._execStreaming(
            `cd ${shellEscape(remoteRoot)} && ${pythonPath} main.py`
        );

        if (this._abort) return 'Aborted';

        if (exitCode === 0) {
            this._sendstd(`${ansi.green_dark}Success\n`);
            return 'Success';
        }

        throw new Error(`Remote Python exited with code ${exitCode}`);
    }

    writeToProcess (message) {
        if (this._activeChannel && this._activeChannel.writable) {
            this._activeChannel.write(message);
        } else {
            throw new Error('No active remote process input is available.');
        }
    }

    _getSftp () {
        return new Promise((resolve, reject) => {
            this._client.sftp((error, sftp) => {
                if (error) return reject(error);
                return resolve(sftp);
            });
        });
    }

    _writeRemoteFile (remotePath, content) {
        return new Promise(async (resolve, reject) => {
            let sftp;
            let stream;
            let settled = false;
            const finish = callback => value => {
                if (settled) return;
                settled = true;
                callback(value);
            };
            try {
                sftp = await this._getSftp();
                stream = sftp.createWriteStream(remotePath, {encoding: null});
                stream.on('error', finish(reject));
                stream.on('finish', finish(resolve));
                stream.on('close', finish(resolve));
                stream.end(content);
            } catch (error) {
                if (stream) {
                    try {
                        stream.destroy();
                    } catch (e) {
                        // ignore destroy errors
                    }
                }
                reject(error);
            }
        });
    }

    _execSimple (command) {
        return new Promise((resolve, reject) => {
            this._client.exec(command, (error, channel) => {
                if (error) return reject(error);
                let stderr = '';
                let settled = false;
                const finish = callback => value => {
                    if (settled) return;
                    settled = true;
                    callback(value);
                };
                channel.on('data', () => {});
                channel.stderr.on('data', data => {
                    stderr += data.toString();
                });
                const handleComplete = finish(code => {
                    if (code === 0) {
                        return resolve();
                    }
                    return reject(new Error(stderr || `Remote command failed: ${command}`));
                });
                channel.on('exit', handleComplete);
                channel.on('close', handleComplete);
                channel.on('error', finish(reject));
            });
        });
    }

    _execStreaming (command) {
        return new Promise((resolve, reject) => {
            this._client.exec(command, (error, channel) => {
                if (error) return reject(error);

                this._activeChannel = channel;

                channel.on('data', data => {
                    this._sendstd(ansi.clear + data.toString());
                });
                channel.stderr.on('data', data => {
                    this._sendstd(ansi.red + data.toString());
                });
                channel.on('error', reject);
                channel.on('close', code => {
                    this._activeChannel = null;
                    resolve(typeof code === 'number' ? code : 0);
                });
            });
        });
    }
}

module.exports = RemoteLinux;
