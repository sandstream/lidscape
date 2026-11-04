# Wallpaper surface tests

Run `sh wallpaper/tests/check-surface-ordering.sh` on a Mac. The test runs the real surface and layer deck with controlled renderer stubs. It checks failed replacement, a queued request, stopping a pending renderer, and layer reuse. It also checks that a stopped request cannot commit its first frame.

The test does not host a remote Core Animation context. It does not check rendered pixels or prove that a buffer flush has completed before a layer is reused. Run the real wallpaper test on a Mac after changes to layer ownership, flushes, or transitions.

## Main actor migration

The surface and layer deck use a serial render queue. The macOS SDK requires main actor access to some sample buffer layer properties. A safe migration must coordinate all access to each layer. It must also wait for the buffer renderer's flush completion before reusing that layer.

Do not synchronously wait for the main queue from the render queue. That can deadlock if the main queue waits for render work. An asynchronous design must preserve request order and invalidate pending work when the surface stops. It must also handle geometry updates, transitions, and context invalidation while a layer operation is pending.

Extend the surface test with controlled main actor operations and flush completions. Test cancellation before and after each completion. Then verify rapid content changes, display sleep, and wallpaper removal with a real remote context.
