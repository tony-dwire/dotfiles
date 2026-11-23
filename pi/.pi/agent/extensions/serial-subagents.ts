/**
 * Serial Subagents - blocks background subagents in pi-fabric.
 *
 * Main may start a subagent only with `agents.run`, which blocks until the
 * child is done. `agents.spawn` (background child) and `agents.create`
 * (persistent background actor) are denied with a reason that points the
 * model to `agents.run`.
 *
 * Needs `"approvals": { "policyHooks": true }` in ~/.pi/agent/fabric.json.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Same value as FABRIC_ACTION_POLICY_REGISTER_EVENT in "pi-fabric/protocol".
const FABRIC_ACTION_POLICY_REGISTER_EVENT = "pi-fabric:action-policy:register:v1";
const HOOK_NAME = "serial-subagents";

const BLOCKED: Record<string, string> = {
    "agents.spawn":
        "Background subagents are blocked. Use `await agents.run({...})` so Main waits until the subagent is done. Only one subagent may run at a time.",
    "agents.create":
        "Persistent background actors are blocked. Use `await agents.run({...})` so Main waits until the subagent is done.",
};

export default function (pi: ExtensionAPI) {
    let registered = false;

    const register = () => {
        if (registered) return;
        pi.events.emit(FABRIC_ACTION_POLICY_REGISTER_EVENT, {
            version: 1,
            name: HOOK_NAME,
            hook: ({ action }: { action: { ref: string } }) => {
                const reason = BLOCKED[action.ref];
                return reason ? { decision: "deny", reason } : undefined;
            },
            respond: (result: { ok: boolean; error?: string }) => {
                registered = result.ok;
            },
        });
    };

    // Fabric may load after this extension, so retry until Fabric confirms.
    // A repeat registration under the same name replaces the old one.
    register();
    pi.on("session_start", async () => register());
    pi.on("before_agent_start", async () => register());
}
