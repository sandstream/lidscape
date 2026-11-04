# Wallpaper handoff checks

The extension uses retirement tickets in its XPC lifecycle path. Each invalidation
creates a ticket. A cancelled or replaced ticket cannot retire the next hosted
interval. A replacement also has a hosting generation. The delayed handoff
checks both generations before it starts retirement. An owner change creates a
new generation and schedules a new handoff after the acquire reply. The reconnect
grace remains 15 seconds. The handoff grace remains 0.75 seconds.

`check-wallpaper-retirement-tickets.sh` compiles the production ticket type and
controls its scheduling closure. It tests stale, duplicate and replacement
callbacks. `check-wallpaper-state-handoff.sh` exercises the actual
`WallpaperState` with fake surfaces and contexts. It checks hosting generations,
preview isolation and state after a first frame arrives during disconnection.
`check-wallpaper-owner-invalidation.sh` checks the atomic owner guard.
`check-wallpaper-handoff-owner-change.sh` checks a replacement owner change.
`check-wallpaper-acquire-cancellation.sh` tests the acquire reply guard with the
real state and a fake surface. It covers cancellation, context replacement,
owner changes, reconnect, repeated completion and reentrant teardown.
`check-wallpaper-real-surface-acquire.sh` tests state, the reply guard and the
real surface together with a fake producer. It checks that stopping an in-flight
build sends one error and that a late frame does not send another reply.
The reply guard does not set its own deadline. If a producer never completes and
the surface is never stopped, the acquire can remain unanswered.
These checks do not call `WallpaperXPCHandler` or host a real CAContext.

The extension build checks that the XPC and state integration compiles. It does
not show that WallpaperAgent receives a correct reply or displays the surface.
Those claims require a real WallpaperAgent session with two hosted surfaces,
reacquisition during handoff, a disappearing replacement, and a lock transition.
The tests must observe the actual image and context lifetime. Invalidation from
a different connection is ignored, including if macOS uses a separate connection
for a legitimate invalidation. The current tests do not establish which
connections WallpaperAgent uses. Check that behavior in the supervised session.

`WallpaperState.tearDownContext` calls `WallpaperSurface.stop` and then calls
the private CAContext invalidation method. This branch does not wait for a
producer stop or layer flush acknowledgement. The method call is not proof that
the system has released its remote resource. The ticket logic does not prove
that new and retiring contexts have independent resources.
