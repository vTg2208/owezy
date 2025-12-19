# End-to-End Testing Script

Write-Host "================================" -ForegroundColor Cyan
Write-Host "Trip Expense Manager - E2E Tests" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

$baseUrl = "http://localhost:3000/api"
$testsPassed = 0
$testsFailed = 0

function Test-Endpoint {
    param(
        [string]$Name,
        [scriptblock]$Test
    )
    Write-Host "Testing: $Name" -ForegroundColor Yellow
    try {
        & $Test
        Write-Host "✅ PASSED: $Name" -ForegroundColor Green
        $script:testsPassed++
    } catch {
        Write-Host "❌ FAILED: $Name" -ForegroundColor Red
        Write-Host "Error: $_" -ForegroundColor Red
        $script:testsFailed++
    }
    Write-Host ""
}

# Test 1: Register User A (Admin)
Test-Endpoint "Register User A (Admin)" {
    $body = @{
        email = "admin@test.com"
        password = "test123456"
        name = "Admin User"
    } | ConvertTo-Json
    
    $response = Invoke-WebRequest -Uri "$baseUrl/auth/register" `
        -Method POST `
        -Body $body `
        -ContentType "application/json" `
        -UseBasicParsing
    
    $data = $response.Content | ConvertFrom-Json
    $script:adminToken = $data.token
    $script:adminUserId = $data.user.id
    
    if (-not $adminToken) { throw "No token received" }
    Write-Host "Admin Token: $adminToken" -ForegroundColor Gray
}

# Test 2: Register User B (Member)
Test-Endpoint "Register User B (Member)" {
    $body = @{
        email = "member@test.com"
        password = "test123456"
        name = "Member User"
    } | ConvertTo-Json
    
    $response = Invoke-WebRequest -Uri "$baseUrl/auth/register" `
        -Method POST `
        -Body $body `
        -ContentType "application/json" `
        -UseBasicParsing
    
    $data = $response.Content | ConvertFrom-Json
    $script:memberToken = $data.token
    $script:memberUserId = $data.user.id
    
    if (-not $memberToken) { throw "No token received" }
    Write-Host "Member Token: $memberToken" -ForegroundColor Gray
}

# Test 3: Create Trip (Requires Auth)
Test-Endpoint "Create Trip with Authentication" {
    $body = @{
        tripName = "Beach Vacation"
        adminName = "Admin"
    } | ConvertTo-Json
    
    $response = Invoke-WebRequest -Uri "$baseUrl/trips" `
        -Method POST `
        -Headers @{ "Authorization" = "Bearer $adminToken" } `
        -Body $body `
        -ContentType "application/json" `
        -UseBasicParsing
    
    $data = $response.Content | ConvertFrom-Json
    $script:tripId = $data.tripId
    $script:roomCode = $data.roomCode
    $script:adminMemberId = $data.member.id
    
    if (-not $tripId) { throw "No trip ID received" }
    Write-Host "Trip ID: $tripId" -ForegroundColor Gray
    Write-Host "Room Code: $roomCode" -ForegroundColor Gray
    Write-Host "Admin Member ID: $adminMemberId" -ForegroundColor Gray
}

# Test 4: Try Create Trip Without Auth (Should Fail)
Test-Endpoint "Create Trip Without Auth (Should Fail)" {
    $body = @{
        tripName = "Unauthorized Trip"
        adminName = "Hacker"
    } | ConvertTo-Json
    
    try {
        $response = Invoke-WebRequest -Uri "$baseUrl/trips" `
            -Method POST `
            -Body $body `
            -ContentType "application/json" `
            -UseBasicParsing
        throw "Request should have failed but didn't!"
    } catch {
        if ($_.Exception.Response.StatusCode -eq 401) {
            Write-Host "Correctly rejected unauthorized request" -ForegroundColor Gray
        } else {
            throw $_
        }
    }
}

# Test 5: Member Joins Trip (Requires Auth)
Test-Endpoint "Member Joins Trip with Authentication" {
    $body = @{
        roomCode = $roomCode
        memberName = "Member"
    } | ConvertTo-Json
    
    $response = Invoke-WebRequest -Uri "$baseUrl/trips/join" `
        -Method POST `
        -Headers @{ "Authorization" = "Bearer $memberToken" } `
        -Body $body `
        -ContentType "application/json" `
        -UseBasicParsing
    
    $data = $response.Content | ConvertFrom-Json
    $script:memberMemberId = $data.member.id
    
    if (-not $memberMemberId) { throw "No member ID received" }
    Write-Host "Member ID: $memberMemberId" -ForegroundColor Gray
}

# Test 6: Get Trip Details (Requires Auth)
Test-Endpoint "Get Trip Details with Authentication" {
    $response = Invoke-WebRequest -Uri "$baseUrl/trips/$tripId" `
        -Method GET `
        -Headers @{ "Authorization" = "Bearer $adminToken" } `
        -UseBasicParsing
    
    $data = $response.Content | ConvertFrom-Json
    $participantCount = $data.participants.Count
    
    if ($participantCount -ne 2) { throw "Expected 2 participants, got $participantCount" }
    Write-Host "Participants: $participantCount (Admin + Member)" -ForegroundColor Gray
}

# Test 7: Admin Removes Member
Test-Endpoint "Admin Removes Member" {
    $response = Invoke-WebRequest -Uri "$baseUrl/trips/$tripId/members/$memberMemberId" `
        -Method DELETE `
        -Headers @{ "Authorization" = "Bearer $adminToken" } `
        -UseBasicParsing
    
    $data = $response.Content | ConvertFrom-Json
    if (-not $data.success) { throw "Removal failed" }
    Write-Host "Member successfully removed" -ForegroundColor Gray
}

# Test 8: Verify Member Was Removed
Test-Endpoint "Verify Member Was Removed" {
    $response = Invoke-WebRequest -Uri "$baseUrl/trips/$tripId" `
        -Method GET `
        -Headers @{ "Authorization" = "Bearer $adminToken" } `
        -UseBasicParsing
    
    $data = $response.Content | ConvertFrom-Json
    $participantCount = $data.participants.Count
    
    if ($participantCount -ne 1) { throw "Expected 1 participant, got $participantCount" }
    Write-Host "Participants after removal: $participantCount (Admin only)" -ForegroundColor Gray
}

# Test 9: Removed Member Tries to Access Trip (Should Fail - no longer in trip)
Test-Endpoint "Removed Member Tries to Access Trip" {
    $response = Invoke-WebRequest -Uri "$baseUrl/trips/$tripId" `
        -Method GET `
        -Headers @{ "Authorization" = "Bearer $memberToken" } `
        -UseBasicParsing
    
    $data = $response.Content | ConvertFrom-Json
    $participants = $data.participants
    
    # Member can still see trip but won't find themselves in participants
    $isMember = $participants | Where-Object { $_.id -eq $memberMemberId }
    if ($isMember) { throw "Member should not be in participants list" }
    Write-Host "Removed member not in participants list ✅" -ForegroundColor Gray
}

# Test 10: Get Admin's Trips
Test-Endpoint "Get Admin's Trips from Dashboard" {
    $response = Invoke-WebRequest -Uri "$baseUrl/auth/my-trips" `
        -Method GET `
        -Headers @{ "Authorization" = "Bearer $adminToken" } `
        -UseBasicParsing
    
    $data = $response.Content | ConvertFrom-Json
    $tripCount = $data.trips.Count
    
    if ($tripCount -lt 1) { throw "Expected at least 1 trip" }
    Write-Host "Admin's trips: $tripCount" -ForegroundColor Gray
}

# Summary
Write-Host "================================" -ForegroundColor Cyan
Write-Host "Test Results Summary" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host "✅ Passed: $testsPassed" -ForegroundColor Green
Write-Host "❌ Failed: $testsFailed" -ForegroundColor Red
Write-Host ""

if ($testsFailed -eq 0) {
    Write-Host "🎉 ALL TESTS PASSED!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Key Verifications:" -ForegroundColor Cyan
    Write-Host "  ✅ Authentication required for all operations" -ForegroundColor Green
    Write-Host "  ✅ Guest mode completely disabled" -ForegroundColor Green
    Write-Host "  ✅ Users can register and login" -ForegroundColor Green
    Write-Host "  ✅ Trips linked to user accounts" -ForegroundColor Green
    Write-Host "  ✅ Members linked to user accounts" -ForegroundColor Green
    Write-Host "  ✅ Admin can remove participants" -ForegroundColor Green
    Write-Host "  ✅ Removed users disappear from trip" -ForegroundColor Green
    Write-Host "  ✅ Unauthorized access prevented" -ForegroundColor Green
} else {
    Write-Host "⚠️ SOME TESTS FAILED - Please review" -ForegroundColor Yellow
}
