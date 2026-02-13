<?php

namespace App\Http\Controllers;

use App\Models\BadgeSynergy;
use Illuminate\Http\JsonResponse;

class BadgeSynergyController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(BadgeSynergy::all());
    }
}
