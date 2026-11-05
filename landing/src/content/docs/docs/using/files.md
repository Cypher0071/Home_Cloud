---
title: File explorer
description: Browse, upload, download and manage files on the host from the browser, and what the explorer refuses to touch.
sidebar:
  order: 2
---

The File Explorer works on the real filesystem of the host. Every action runs as the same Linux user as the Home Cloud service, so it can only do what that user can do.

## Layout

- **Address bar:** back, forward, up and refresh buttons, and a clickable path. Click the path or press `Ctrl+L` to type a path directly.
- **Sidebar:** `Home` and a `Devices` list of drives with a usage bar.
- **Toolbar:** Upload, New Folder, New File, Copy, Cut, Paste, Rename, Delete and View.
- **File list:** Name, Size and Date Modified. Right-click an item or the empty background for a context menu.

You can select several items with `Ctrl`-click, `Shift`-click or by dragging a box around them. `Ctrl+A` selects everything in the folder.

| Shortcut | Action |
| --- | --- |
| `Ctrl+L` | Edit the path |
| `Ctrl+C` | Copy the selection |
| `Ctrl+X` | Cut the selection |
| `Ctrl+V` | Paste |
| `Ctrl+A` | Select all |

On macOS, `Cmd` works in place of `Ctrl`.

## What you can access

The explorer has two modes. You switch between them in Settings, under Storage & System.

| Mode | Reachable paths |
| --- | --- |
| Safe Server Mode (default) | Your home directory, `/mnt`, `/media`, `/run/media`, `/srv`, and any custom storage paths |
| Full System Root Access | The whole filesystem from `/` |

Paths are resolved to their real location before the check, so a symlink in your home directory that points to `/etc` is refused in Safe Server Mode. The home directory is the one the agent runs under, or `BASE_DIR` if you set it in `agent/.env`.

`/proc`, `/sys` and `/dev` are blocked in both modes. There is no setting that unblocks them.

Custom storage paths are saved in `~/.config/home-cloud/preferences.json` under `customStoragePaths`. The dashboard has no editor for them. The agent reads that file once at startup, so restart the service after you edit it.

:::caution
Turning on Full System Root Access lets anyone who signs in read and change system directories, within the permissions of the service user. Read [Full system access](/docs/configuration/full-system-access/) first.
:::

## Drives

The Devices list shows mounted filesystems of these types: ext2, ext3, ext4, btrfs, xfs, zfs, f2fs, jfs, ntfs, exfat, vfat, fat16, fat32, apfs, hfs+ and drvfs (Windows drives under WSL). Virtual and network mounts are not listed. The list is cached for 10 seconds.

With Full System Root Access on, a `System Root (/)` entry is added if the host did not already report `/`.

A drive appearing in the list does not mean it is reachable. In Safe Server Mode a drive mounted outside `/mnt`, `/media`, `/run/media` and `/srv` is listed but refused. Add its mount point as a custom storage path, or enable full access.

## Upload and download

**Upload.** Choose Upload and pick a file. The dashboard sends one file per upload and shows a progress bar. The server accepts files up to 2 GiB.

:::caution
The server does not check whether a file with the same name already exists in the folder. An upload with the same name replaces it.
:::

**Download.** Right-click a file and choose Download. You can download one file at a time. There is no folder download and no zip of a selection.

**View.** View opens a preview. PNG, JPEG, GIF and WebP images show inline. Text files show as text. For every other type the server sends the file as an attachment, so use Download instead. HTML and SVG are never rendered inline, by design.

There is no in-browser text editor.

## Create, rename, copy and move

- **New Folder** and **New File** create an empty folder or an empty file. They fail if the name is taken.
- **Rename** fails if the new name already exists.
- **Copy** and **Paste** copy files and whole folders. Paste fails if an item with that name already exists at the destination. Nothing is merged or overwritten.
- **Cut** and **Paste** move items. If the source and destination are on different drives, the agent copies the item and then deletes the original.

## Delete

Delete removes files and folders for good. A folder is removed with everything in it. There is no trash and no undo.

The dashboard asks for confirmation first. If the folder you are in is outside your home directory, it asks a second time.

## Search

Type in the search box to search the current folder and everything under it. Matching is fuzzy, and the list shows the best 50 results. The file finder skips hidden files and anything a `.gitignore` excludes.

Search needs two programs on the host: `fdfind` and `fzf`. The installer does not install them. On Debian and Ubuntu they come from the `fd-find` and `fzf` packages. If either is missing, search returns an error and everything else keeps working.

## Errors you might see

| Message | Meaning |
| --- | --- |
| Access denied: path is outside allowed storage scope | The path is outside the current mode's reach, or it is under `/proc`, `/sys` or `/dev` |
| Permission denied by host OS | The Linux user running Home Cloud lacks permission on that file |
| A file or folder named "x" already exists | Rename, copy, move or create hit an existing name |

For other problems see [Troubleshooting](/docs/operations/troubleshooting/).
