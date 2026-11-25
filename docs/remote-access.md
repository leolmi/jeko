---
layout: default
title: Remote access
description: Follow and manage Jeko tasks from your phone
---

**English** · [Italiano](./it/accesso-remoto.html) · [Jeko](./)

# Remote access

Follow and manage Jeko tasks from your phone (or another computer), even away from home. It opens as a page in the browser, with no app to install. Every Jeko installation has its own access: channel, keys and QR codes are generated on your PC.

The remote page uses the language chosen in Jeko (Italian or English).

## What you can do remotely

- see projects and tasks: on the home page, the ones waiting for an answer, then your favorites in their order, then the other projects;
- follow a task's activity: long messages are partly shown, with **Show all** to open them;
- start a task from the chat at the bottom of the page, as in the web app:
  - **with or without a workflow** (direct task: the Agent carries out the request as it is);
  - **Autonomous**, **Checkpoint** or **Interactive** control;
  - the Agent's **model and effort** (defaults: the project's);
  - if a task is already at work on the same project, the new one is **queued**;
- continue a direct task that is waiting for a follow-up, or start again from the conversation of a finished one;
- answer the Agent's questions, approve or reject gates and reviews;
- cancel a task;
- manage notes ("Notes" tab on the home page): add, edit and delete them and, if they have a project, turn them into a task with "Create task", which opens the project with the text already in the chat.

Everything else (options, workflows, new projects) stays on the PC.

## How it works

```
phone ──HTTPS──▶ relay ◀──WebSocket── Jeko on the PC
```

- The **relay** is a small bridge server: it serves the remote page and routes messages between Jeko and the devices. Jeko is the one connecting to the relay, so no port is opened to the outside on the PC.
- Messages are **end-to-end encrypted** (AES-GCM) with a different key for each device. The relay cannot read them: it only keeps the latest encrypted state for each device, so the page shows something even if Jeko is briefly offline.
- The key is in the **QR code**, in the part of the link after `#`, which the browser never sends to the server. Once the page is open, the link disappears from the address bar and the key is stored in the browser as a **non-extractable** key (IndexedDB): it can be used to encrypt, but not even a script in the page can read it.

## Setup with Tailscale Funnel (recommended)

The relay runs inside Jeko, on your PC; [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) makes it reachable from the internet over HTTPS, with a fixed address and without touching the router.

1. Install [Tailscale](https://tailscale.com/download) on the PC and sign in with your account.
2. Enable Funnel: the first time, the command in step 3 gives you a link to the Tailscale console where you can turn it on (HTTPS certificates are needed too; the same page offers them).
3. Expose the relay port (it stays on after a restart too):

   ```sh
   tailscale funnel --bg 8787
   ```

   `tailscale funnel status` shows the address, something like `https://<pc-name>.<tailnet>.ts.net`.

4. In Jeko, **Options → Remote access**:
   - relay address: the one from step 3;
   - tick **Relay on this PC** and **On**, then **Save**.

   The status becomes "Connected to the relay". Jeko starts the relay on `127.0.0.1:8787` and generates by itself the secret that stops others from opening channels on your relay.

## Connecting a device

1. **Connect a device**: a QR code appears, valid for 15 minutes.
2. Scan it with your phone (or copy the link) and open the page.
3. The device shows up in the list as "to confirm": press **Confirm** on the PC. Only from then on can it see data and make requests.
4. From then on, just reopen the relay address in that browser: the pairing stays saved.

To remove it: the bin icon next to the device. The page on the phone closes and, to use it again, it has to be connected again.

## Good to know

- **The PC must be on and Jeko running.** With confirmed devices, the service no longer shuts down by itself when the window is closed. With the relay on this PC, the page can't be reached while the PC is off.
- **Anyone opening the address without the QR code** sees the page but can't do anything: without the key they can neither read nor send messages, and without confirmation on the PC a key is not enough.
- **Don't share the QR code or the link**: they contain the device key.
- Data on the PC, in `%LOCALAPPDATA%\jeko\data`: `remote.json` (channel, secret, devices with their keys) and `relay/channels.json` (token hashes only).

## Alternatively: a relay on a server

The relay is also a standalone program (`packages/relay`, see its [README](https://github.com/leolmi/jeko/tree/main/packages/relay)) to run on a server reachable over HTTPS. In that case, leave "Relay on this PC" off in Jeko, enter the server's address and, if the relay has `RELAY_SECRET`, the same secret. Useful if you want the page to show the latest state even while the PC is off.
