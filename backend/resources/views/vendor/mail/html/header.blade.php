@props(['url'])
<tr>
<td class="header">
<a href="{{ $url }}" style="display: inline-block;">
@if (trim($slot) === 'Laravel')
<img src="https://laravel.com/img/notification-logo-v2.1.png" class="logo" alt="Laravel Logo">
@else
{{-- Gold/black basketball logo — hosted by the frontend deploy at /email/logo.png --}}
<img src="{{ rtrim(config('app.frontend_url'), '/') }}/email/logo.png" class="logo" alt="{!! $slot !!}">
<span class="header-name">{!! $slot !!}</span>
@endif
</a>
</td>
</tr>
