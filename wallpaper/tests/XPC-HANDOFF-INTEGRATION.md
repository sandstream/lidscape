# XPC handoff experiment

The experimental extension now uses retirement tickets in its XPC lifecycle path.
Each invalidation creates a new ticket. A cancelled or replaced ticket cannot
retire the next hosted interval. A replacement also has a hosting generation.
The delayed handoff checks both generations before it starts retirement.
The reconnect grace remains 15 seconds. The handoff grace remains 0.75 seconds.

`check-wallpaper-retirement-tickets.sh` compiles the production ticket type.
It controls its scheduling closure and tests stale, duplicate and replacement
callbacks. `check-xpc-surface-handoff-prototype.sh` tests the separate lifecycle
model, including asynchronous stop, flush and disposal.
`check-wallpaper-state-handoff.sh` exercises the actual `WallpaperState` with
fake surfaces and contexts. It checks hosting generations, preview isolation,
and the wait for surface stop before context invalidation. It also checks that
a late stop callback does not invalidate a new context under the same key.
These checks do not call `WallpaperXPCHandler` or host a real CAContext.

The extension build checks that the XPC and state integration compiles. It does
not show that WallpaperAgent receives a correct reply or displays the surface.
Those claims require a real WallpaperAgent session with two hosted surfaces,
reacquisition during handoff, a disappearing replacement, and a lock transition.
The tests must observe the actual image and context lifetime. Do not register or
select this experimental extension without a supervised session.

`WallpaperState.tearDownContext` waits for `WallpaperSurface.invalidate` before
it calls the private CAContext invalidation method. That call is not proof that
the system has released its remote resource. A missing stop or flush callback
also has no timeout or bounded resource recovery in this experiment. The new
ticket logic does not connect the separate MainActor layer owner to production,
and it does not prove that new and retiring contexts have independent resources.
