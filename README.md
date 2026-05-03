# BlockGPT Link

BlockGPT Link provides the local connectivity layer for BlockGPT.

It is responsible for device transport, upload flows, serial communication, Bluetooth communication, and the local service interface used by BlockGPT GUI and BlockGPT Link Desktop.

## Main responsibilities

- serial communication bridge
- BLE / Web BLE related transport handling
- upload support for Arduino, MicroPython, micro:bit, and related hardware targets
- local service process used by the desktop companion app

## Start locally

```bash
npm install
npm run fetch
npm start
```

## Notes

- On macOS, `@abandonware/bluetooth-hci-socket` is not supported in the same way as Linux or Windows. Hardware workflows should prefer the browser-side Web BLE / Web Serial paths when available.
- Tool archives and board support packages are expected to live under `tools/`.

## Product role

This repository exists to support the BlockGPT product goal of making AI-assisted Scratch-style programming work with real hardware in classrooms, labs, and maker environments.
