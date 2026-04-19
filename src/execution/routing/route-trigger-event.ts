import {
  allowsUnboundThread,
  hasDirectThreadRouting,
  hasSubjectRouting,
  type TriggerEvent
} from "../contracts/trigger-event.js";
import type { Thread } from "../../threads/domain/thread.js";
import type { ThreadStore } from "../../threads/store/thread-store.js";
import { resolveSubjectThread } from "./resolve-subject-thread.js";
import { trace } from "../../utils/trace.js";

export const triggerRouteKind = {
  directThread: "direct_thread",
  subjectMatch: "subject_match",
  subjectCreate: "subject_create",
  unboundCreate: "unbound_create"
} as const;

type TriggerRouteKind = (typeof triggerRouteKind)[keyof typeof triggerRouteKind];

export interface TriggerRouteResult {
  kind: TriggerRouteKind;
  thread: Thread;
}

export const triggerRoutingErrorCode = {
  threadNotFound: "thread_not_found",
  unroutableTrigger: "unroutable_trigger"
} as const;

type TriggerRoutingErrorCode =
  (typeof triggerRoutingErrorCode)[keyof typeof triggerRoutingErrorCode];

export class TriggerRoutingError extends Error {
  constructor(
    readonly code: TriggerRoutingErrorCode,
    message: string
  ) {
    super(message);
    this.name = "TriggerRoutingError";
  }
}

interface RouteTriggerEventDependencies {
  threadStore: ThreadStore;
}

export async function routeTriggerEvent(
  triggerEvent: TriggerEvent,
  dependencies: RouteTriggerEventDependencies
): Promise<TriggerRouteResult> {
  trace("routing", "resolve trigger route", {
    triggerId: triggerEvent.trigger_id
  });
  const { threadStore } = dependencies;

  if (hasDirectThreadRouting(triggerEvent)) {
    const threadId = triggerEvent.routing.thread_id!;
    const thread = await threadStore.get(threadId);

    if (thread === null) {
      throw new TriggerRoutingError(
        triggerRoutingErrorCode.threadNotFound,
        `Thread ${threadId} was not found.`
      );
    }
    trace("routing", "direct thread route", {
      triggerId: triggerEvent.trigger_id,
      threadId
    });

    return {
      kind: triggerRouteKind.directThread,
      thread
    };
  }

  if (hasSubjectRouting(triggerEvent)) {
    const subjectType = triggerEvent.routing.subject_type!;
    const subjectId = triggerEvent.routing.subject_id!;
    const existingThread = await resolveSubjectThread(subjectType, subjectId, threadStore);

    if (existingThread !== null) {
      trace("routing", "subject matched existing thread", {
        triggerId: triggerEvent.trigger_id,
        threadId: existingThread.threadId,
        subjectType,
        subjectId
      });
      return {
        kind: triggerRouteKind.subjectMatch,
        thread: existingThread
      };
    }

    const thread = await threadStore.create({
      subjectType,
      subjectId
    });
    trace("routing", "subject created new thread", {
      triggerId: triggerEvent.trigger_id,
      threadId: thread.threadId,
      subjectType,
      subjectId
    });

    return {
      kind: triggerRouteKind.subjectCreate,
      thread
    };
  }

  if (allowsUnboundThread(triggerEvent)) {
    const thread = await threadStore.create({});
    trace("routing", "created unbound thread", {
      triggerId: triggerEvent.trigger_id,
      threadId: thread.threadId
    });

    return {
      kind: triggerRouteKind.unboundCreate,
      thread
    };
  }

  throw new TriggerRoutingError(
    triggerRoutingErrorCode.unroutableTrigger,
    "TriggerEvent does not contain routable thread metadata."
  );
}
