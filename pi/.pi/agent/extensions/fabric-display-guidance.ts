import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Event names from "pi-fabric/protocol". They are written here as plain strings,
// so this file does not need to resolve the pi-fabric package at load time.
const FABRIC_COMPONENT_REGISTER_EVENT = "pi-fabric:component:register:v1";
const FABRIC_COMPONENT_DISCOVER_EVENT = "pi-fabric:component:discover:v1";

// Guidance applies to every model. Fabric matches "*" against the full
// "provider/model" name, and "*" also matches "/".
const ALL_MODELS = ["*"];

// The display-first check is enforced only on these local models.
const LOCAL_MODELS = ["strata/*", "llama.cpp/*"];

const GUIDANCE = `Every fabric_exec call MUST set display: { name, description }. The user reads these as the title of each step. Never skip them.

Write "display" as the FIRST argument of the call, before "code". Write "name" before "description". The user sees the title while you are still writing the code.

name (the title):
- 3 to 8 words. Start with a verb. Say WHAT you do and WHERE.
- Name the real file, module, class, or command. Do not use generic words.
- Good: "Read ReportingModule invoice controller", "Run Core tests for cost share", "Fix null check in ProjectExtensions".
- Bad: "Run code", "Execute", "Step 2", "Investigate", "Check things", "fabric".

description:
- One full sentence. Say WHY you run this call and WHAT result you expect.
- Good: "Find where the quarterly report PDF sets the due date, to locate the off-by-one bug."
- Bad: "Reading files.", "Doing the task.", or a copy of the name.

Write a new name and description for each call. Do not reuse the last one.`;

// The display schema the model sees: an object only, with name first,
// and both fields required.
const DISPLAY_SCHEMA = {
    type: "object",
    description: "Title shown to the user. Write this first, before code.",
    properties: {
        name: {
            type: "string",
            description: "Title: 3-8 words, starts with a verb, names the real file/module/command.",
        },
        description: {
            type: "string",
            description: "One sentence: why this call runs and what result you expect.",
        },
    },
    required: ["name", "description"],
};

// Return a copy of the fabric_exec parameters with display first and required.
// Models usually write arguments in schema order. llama.cpp grammars also put
// required properties before optional ones, so display must be required too.
// Pi still checks the call against Fabric's own schema, so this only changes
// what the model is asked to write.
const reorderParameters = (parameters: any): any => {
    if (!parameters || typeof parameters !== "object" || !parameters.properties) return parameters;
    const { display: _display, ...rest } = parameters.properties;
    const required: string[] = Array.isArray(parameters.required) ? parameters.required : [];
    return {
        ...parameters,
        properties: { display: DISPLAY_SCHEMA, ...rest },
        required: ["display", ...required.filter((key) => key !== "display")],
    };
};

const rewriteTool = (tool: any): any => {
    // OpenAI chat completions: { type: "function", function: { name, parameters } }
    if (tool?.function?.name === "fabric_exec") {
        return { ...tool, function: { ...tool.function, parameters: reorderParameters(tool.function.parameters) } };
    }
    // OpenAI responses: { type: "function", name, parameters }
    if (tool?.name === "fabric_exec" && tool.parameters) {
        return { ...tool, parameters: reorderParameters(tool.parameters) };
    }
    // Anthropic-style: { name, input_schema }
    if (tool?.name === "fabric_exec" && tool.input_schema) {
        return { ...tool, input_schema: reorderParameters(tool.input_schema) };
    }
    return tool;
};

export const rewritePayload = (payload: any): any => {
    if (!payload || !Array.isArray(payload.tools)) return undefined;
    if (!payload.tools.some((tool: any) => (tool?.function?.name ?? tool?.name) === "fabric_exec")) return undefined;
    return { ...payload, tools: payload.tools.map(rewriteTool) };
};

const component = {
    name: "display-guidance",
    description: "Make models write clear fabric_exec display titles, display first",
    guarantee: "revertible",
    activate(context: any) {
        context.guide({
            label: "display-rules",
            models: ALL_MODELS,
            targets: ["main", "participant"],
            content: GUIDANCE,
        });
    },
};

// Raw argument key order, in the order the model wrote it, keyed by tool call id.
// Pi validates and may copy the arguments before the tool_call hook, so the
// order is read from the finished assistant message instead.
const rawArgumentKeys = new Map<string, string[]>();

export const recordArgumentOrder = (message: any): void => {
    if (message?.role !== "assistant" || !Array.isArray(message.content)) return;
    for (const part of message.content) {
        if (part?.type !== "toolCall" || part.name !== "fabric_exec" || typeof part.id !== "string") continue;
        if (part.arguments && typeof part.arguments === "object") {
            rawArgumentKeys.set(part.id, Object.keys(part.arguments));
        }
    }
};

const BLOCK_REASON = (firstKey: string | undefined) =>
    `fabric_exec call rejected: "display" must be the FIRST argument, before "code" and all others. ` +
    `The first argument was "${firstKey ?? "(none)"}". ` +
    `Retry the same call and start it with display: { name: "<verb + what + where, 3-8 words>", ` +
    `description: "<one sentence: why and expected result>" }, then write code.`;

export const checkDisplayFirst = (toolCallId: string, input: any): string | undefined => {
    const keys = rawArgumentKeys.get(toolCallId) ?? Object.keys(input ?? {});
    rawArgumentKeys.delete(toolCallId);
    return keys[0] === "display" ? undefined : BLOCK_REASON(keys[0]);
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// True when "provider/model" matches one of the LOCAL_MODELS globs.
const globMatches = (pattern: string, name: string): boolean =>
    new RegExp("^" + pattern.split("*").map(escapeRegExp).join("[\\s\\S]*") + "$").test(name);

// True when the active model in ctx is one of the local models.
// Fails open: an unknown model is not treated as local.
const isLocalModel = (ctx: any): boolean => {
    const model = ctx?.model;
    if (!model) return false;
    const name = `${model.provider}/${model.id}`;
    return LOCAL_MODELS.some((pattern) => globMatches(pattern, name));
};

export default function extension(pi: ExtensionAPI) {
    pi.events.emit(FABRIC_COMPONENT_REGISTER_EVENT, {
        version: 1,
        component,
        overwrite: true,
    });
    pi.events.on(FABRIC_COMPONENT_DISCOVER_EVENT, (discovery: any) => {
        discovery.register(component, { overwrite: true });
    });

    pi.on("before_provider_request", (event: any) => rewritePayload(event.payload));

    pi.on("message_end", (event: any) => recordArgumentOrder(event.message));

    // Reject a fabric_exec call on a local model unless display came first.
    // On other models drop the recorded key order and let the call through.
    pi.on("tool_call", (event: any, ctx: any) => {
        if (event.toolName !== "fabric_exec") return undefined;
        if (!isLocalModel(ctx)) {
            rawArgumentKeys.delete(event.toolCallId);
            return undefined;
        }
        const reason = checkDisplayFirst(event.toolCallId, event.input);
        return reason ? { block: true, reason } : undefined;
    });
}
