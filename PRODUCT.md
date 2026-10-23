# Product

## Register

product

## Users

One person: the developer who built and owns this home server. Developer-adjacent, comfortable
with technical tools. Uses the dashboard to manage a spare Linux PC running at home as a
remote server via Cloudflare Tunnel. Primary context: desktop or laptop, dim room, night or
late evening, task-focused. Not casual browsing. Every interaction is purposeful: checking
metrics, killing a container, grabbing a file, running a shell command.

## Product Purpose

Home Cloud is a self-hosted control dashboard for a personal Linux server accessed remotely
through a Cloudflare Tunnel. It replaces the need for a paid cloud VM by turning a spare PC
into a remotely managed server. The dashboard acts as the unified control plane: system
monitoring, terminal access, file management, and Docker container lifecycle. Success means
the user can reach the information or action they need in under 5 seconds with no friction.

## Brand Personality

Precise, minimal, focused. The tool disappears into the task. No ceremony, no decoration,
no interface that draws attention to itself. Confidence through clarity.

## Anti-references

- Umbrel and CasaOS: consumer-soft card grids and macOS-imitating aesthetics
- Generic glassmorphism / blur-heavy SaaS dark dashboards
- Purple gradient AI-tool aesthetic. The dashboard theme is already the neutral theme in `dashboard/src/index.css`; do not bring that look back.
- macOS traffic-light window controls and dock magnification
- Any design where you can guess the aesthetic from the category ("dark dashboard = blue")

## Design Principles

1. **Task first.** Every design decision is judged by whether it helps the user complete the
   current task faster, not whether it looks impressive.
2. **Data is the content.** Numbers, paths, status indicators, and log output are first-class
   citizens. Typography and color exist to make data legible, not decorative.
3. **No state is ambiguous.** Running vs. stopped, connected vs. offline, high load vs. normal:
   every system state has an unambiguous visual signal. Never leave the user guessing.
4. **Restraint earns trust.** A tool that does not try to impress feels reliable. Decoration
   signals insecurity. The interface should feel inevitable, not designed.
5. **Consistency is an affordance.** Same button shape, same status vocabulary, same spacing
   rhythm everywhere. Predictability accelerates task completion.

## Accessibility & Inclusion

WCAG AA minimum. Focus-visible on all interactive elements. Keyboard-navigable window
controls and dock. Status colors always paired with a non-color signal (icon, label, or
shape). Respect prefers-reduced-motion.
