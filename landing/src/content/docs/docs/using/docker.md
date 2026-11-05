---
title: Docker and Compose
description: Manage containers, images and Compose projects from Docker Manager, and know what the agent does behind each button.
sidebar:
  order: 4
---

Docker Manager talks to the Docker daemon on the host through its socket. It has three tabs: **Containers**, **Images** and **Compose**. Home Cloud does not run its own container runtime. If Docker is not installed or the service user is not in the `docker` group, the tabs show errors. See [Requirements](/docs/getting-started/requirements/).

:::danger
Docker access is root-equivalent. A container can mount `/` and read or write any file on the host. Everyone who can sign in to the dashboard can do this. See the [threat model](/docs/security/threat-model/).
:::

## Containers

The Containers tab lists every container, running or not. Each row has Start, Stop, Restart and Delete. There is no pause. Delete asks you to confirm, and it only works on a stopped container.

Select a container to open its detail pane.

| Tab | Shows |
| --- | --- |
| Stats | Live CPU %, memory, network I/O and block I/O, streamed from Docker |
| Inspect | The container's `docker inspect` data, with a search box |
| Logs | A live follow of stdout and stderr with timestamps. It starts with the last 200 lines. You can pause the stream, and Download saves the full log as `<name>-logs.txt`. |
| Console | A shell inside the container. See [Terminal](/docs/using/terminal/). |

### Run a container

Run a container from an image in the Images tab. The form takes:

- **Name** (optional).
- **Ports:** host port to container port. These are always TCP.
- **Volumes:** a Docker named volume such as `pgdata`, or a host path to bind into the container (read-write).
- **Environment variables.**
- **Restart policy.**

The container is created and started in one step. If the image is not on the host yet, the request fails with a message telling you to pull it.

Bind-mount host paths are checked. The form accepts only paths inside your home directory. The server also applies the same scope rules as the [file explorer](/docs/using/files/#what-you-can-access).

### Expose a container

Each container row has an expose button with a globe icon. It needs `CF_DOMAIN` to be set and the container to have a published host port. You give it a subdomain, and the agent adds a rule to the `cloudflared` config and restarts `cloudflared`. It uses the first published host port. Deleting the container, or a Compose project, removes the rule again.

:::caution
An exposed app is on the public internet. Home Cloud's password does not protect it. Put a Cloudflare Access policy in front of anything sensitive. See [Remote access](/docs/getting-started/remote-access/).
:::

## Images

The Images tab lists local images with tag, short ID, size and age.

- **Pull:** type a reference such as `redis:alpine` and the agent streams the pull progress. References are checked against a strict pattern and must be 255 characters or fewer.
- **Delete:** removes one image. Docker refuses if a container uses it.
- **Prune:** removes every image that no container uses, not only dangling ones. It does not ask for confirmation.

## Compose

The Compose tab lists Compose projects. It shows projects Home Cloud created and any other running containers that carry a Compose project label, such as ones started from a terminal. A project with a saved file but no containers shows as not created.

A project's status is `running` when all its containers run, `partial` when some run, and `stopped` otherwise.

### Where projects are stored

Home Cloud saves each project it deploys to:

```text
~/.home-cloud/compose/<project-name>/docker-compose.yml
```

If the folder already has `docker-compose.yaml`, `compose.yml` or `compose.yaml`, that file is reused. Older installs kept projects in `~/.home-cloud/stacks`. The agent moves them into `compose` on startup and keeps a symlink at the old path. The `/api/docker/stacks` route still works as an alias.

Project names may use letters, digits, dots, underscores and hyphens. The dashboard form limits them to lowercase letters, digits and hyphens.

### Deploy and import

Choose **Deploy Compose Project**. Pick a name, then use one of two modes:

- **Form View:** add services, then fill in image, ports, volumes, environment variables and restart policy. The form writes the YAML for you.
- **YAML Editor:** paste or write Compose YAML.

To import an existing file, choose **Upload YAML** and select a `.yml` or `.yaml` file from your computer. It loads into the editor. Nothing is deployed until you submit.

On submit, the agent saves the YAML and runs:

```bash
docker compose -f <file> -p <name> up -d --remove-orphans
```

Output streams to the dashboard as it runs. Because of `--remove-orphans`, a service you delete from the YAML is removed from the project on the next deploy. If the browser disconnects during a deploy, the agent stops the `docker compose` process. The exception is a session revocation: then the deploy runs to completion and only the stream to the browser ends.

The host needs the `docker compose` plugin. The Compose YAML you submit is passed to Docker as written.

:::caution
The file explorer's storage scope does not apply to Compose YAML. A Compose file can bind any host path and use options such as `privileged`. Only deploy YAML you have read.
:::

### Manage a project

| Action | What it runs |
| --- | --- |
| Start | `docker compose start`. If nothing was created yet, it runs `up -d`. |
| Stop | `docker compose stop` |
| Logs | A live, combined follow of all services, starting with the last 200 lines |
| Edit and redeploy | Opens the saved YAML. Submitting runs the deploy command again. |
| Delete | `docker compose down -v`, then removes the project folder |

:::danger
Delete uses `down -v`. It removes the project's containers, networks and named volumes, and the saved YAML. Data in named volumes is lost. Bind-mounted host folders are not touched. Back up first. See [Backup](/docs/operations/backup/).
:::

## When something fails

Docker's own error message is shown in the dashboard. For common causes, such as permission errors on the Docker socket, see [Troubleshooting](/docs/operations/troubleshooting/).
