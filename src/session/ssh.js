const {Client} = require('ssh2');
const ansi = require('ansi-string');
const Buffer = require('buffer').Buffer;

const Session = require('./session');
const RemoteLinux = require('../upload/remoteLinux');

class SSHSession extends Session {
    constructor (socket) {
        super(socket);

        this._type = 'ssh';
        this._client = null;
        this._connected = false;
        this._target = null;
        this.tool = null;
    }

    async didReceiveCall (method, params, completion) {
        switch (method) {
        case 'connect':
            await this.connect(params);
            completion(null, null);
            break;
        case 'disconnect':
            await this.disconnect();
            completion(null, null);
            break;
        case 'write':
            completion(await this.write(params), null);
            break;
        case 'upload':
            completion(await this.upload(params), null);
            break;
        case 'abortUpload':
            completion(await this.abortUpload(), null);
            break;
        default:
            throw new Error('Method not found');
        }
    }

    connect (params) {
        const target = Object.assign({port: 22}, params);
        this._target = target;

        if (this._client) {
            return this.disconnect().then(() => this.connect(target));
        }

        return new Promise((resolve, reject) => {
            const client = new Client();
            let settled = false;

            const cleanup = () => {
                client.removeAllListeners('ready');
                client.removeAllListeners('error');
                client.removeAllListeners('close');
                client.removeAllListeners('end');
            };

            client.on('ready', () => {
                cleanup();
                this._client = client;
                this._connected = true;

                this.sendRemoteRequest('onMessage', {
                    message: Buffer.from(
                        `Connected to ${target.host}:${target.port || 22} as ${target.username}\r\n`
                    ).toString('base64')
                });

                client.on('close', () => {
                    if (this._connected) {
                        this._connected = false;
                        this._client = null;
                        this.sendRemoteRequest('onMessage', {
                            message: Buffer.from(
                                `Disconnected from ${target.host}:${target.port || 22}\r\n`
                            ).toString('base64')
                        });
                        this.sendRemoteRequest('peripheralUnplug', null);
                    }
                });
                client.on('end', () => {
                    if (this._connected) {
                        this._connected = false;
                        this._client = null;
                        this.sendRemoteRequest('onMessage', {
                            message: Buffer.from(
                                `Disconnected from ${target.host}:${target.port || 22}\r\n`
                            ).toString('base64')
                        });
                        this.sendRemoteRequest('peripheralUnplug', null);
                    }
                });
                client.on('error', error => {
                    if (this._connected) {
                        this.sendRemoteRequest('uploadError', {
                            message: ansi.red + error.message
                        });
                    }
                });

                settled = true;
                resolve();
            });

            client.on('error', error => {
                if (settled) return;
                cleanup();
                settled = true;
                reject(new Error(error.message || 'SSH connection failed'));
            });

            client.connect({
                host: target.host,
                port: target.port || 22,
                username: target.username,
                password: target.password,
                readyTimeout: 10000
            });
        });
    }

    disconnect () {
        return new Promise(resolve => {
            if (this.tool) {
                this.tool.abortUpload();
                this.tool = null;
            }
            if (this._client) {
                const client = this._client;
                this._client = null;
                this._connected = false;
                try {
                    client.end();
                } catch (e) {
                    // ignore end errors
                }
            }
            resolve();
        });
    }

    async write (params) {
        if (!this.tool) {
            throw new Error('No active remote process is accepting input.');
        }
        const {message, encoding} = params;
        const data = Buffer.from(message, encoding || 'utf8').toString();
        this.tool.writeToProcess(data);
        return data.length;
    }

    async upload (params) {
        if (!this._connected || !this._client) {
            throw new Error('Remote Linux board is not connected.');
        }

        const {message, config, encoding} = params;
        const code = Buffer.from(message, encoding).toString();

        this.tool = new RemoteLinux(
            this._client,
            this._target,
            config,
            this.sendstd.bind(this),
            this.sendRemoteRequest.bind(this)
        );

        try {
            const result = await this.tool.upload(code);
            this.sendRemoteRequest('uploadSuccess', {aborted: result === 'Aborted'});
        } catch (error) {
            this.sendRemoteRequest('uploadError', {
                message: ansi.red + (error.message || String(error))
            });
        }

        this.tool = null;
    }

    async abortUpload () {
        if (this.tool) {
            this.tool.abortUpload();
        } else {
            this.sendRemoteRequest('uploadSuccess', {aborted: true});
        }
    }

    sendstd (message) {
        if (this._socket) {
            this.sendRemoteRequest('uploadStdout', {message});
        }
    }

    dispose () {
        this.disconnect();
        super.dispose();
    }
}

module.exports = SSHSession;
