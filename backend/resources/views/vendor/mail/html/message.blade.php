<x-mail::layout>
{{-- Header — links to the player-facing app, not the API --}}
<x-slot:header>
<x-mail::header :url="rtrim(config('app.frontend_url'), '/')">
Bball Sim - Dynasty Basketball
</x-mail::header>
</x-slot:header>

{{-- Body --}}
{!! $slot !!}

{{-- Subcopy --}}
@isset($subcopy)
<x-slot:subcopy>
<x-mail::subcopy>
{!! $subcopy !!}
</x-mail::subcopy>
</x-slot:subcopy>
@endisset

{{-- Footer --}}
<x-slot:footer>
<x-mail::footer>
© {{ date('Y') }} Bball Sim - Dynasty Basketball. {{ __('All rights reserved.') }}
</x-mail::footer>
</x-slot:footer>
</x-mail::layout>
