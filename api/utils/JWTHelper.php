<?php
class JWTHelper {
    private static $secret_key = 'your-secret-key-here';

    public static function generateToken($user_id, $email, $role = 'user') {
        $header = json_encode(['typ' => 'JWT', 'alg' => 'HS256']);
        $payload = json_encode([
            'iss' => 'helplagbe',
            'aud' => 'helplagbe-users',
            'iat' => time(),
            'exp' => time() + (24 * 60 * 60),
            'user_id' => $user_id,
            'email' => $email,
            'role' => $role
        ]);

        $base64UrlHeader = rtrim(strtr(base64_encode($header), '+/', '-_'), '=');
        $base64UrlPayload = rtrim(strtr(base64_encode($payload), '+/', '-_'), '=');

        $signature = hash_hmac('sha256', $base64UrlHeader . "." . $base64UrlPayload, self::$secret_key, true);
        $base64UrlSignature = rtrim(strtr(base64_encode($signature), '+/', '-_'), '=');

        return $base64UrlHeader . "." . $base64UrlPayload . "." . $base64UrlSignature;
    }

    public static function validateToken($token) {
        $parts = explode('.', $token);
        if (count($parts) !== 3) return false;

        list($header, $payload, $signature) = $parts;

        $expectedSignature = rtrim(strtr(base64_encode(
            hash_hmac('sha256', $header . "." . $payload, self::$secret_key, true)
        ), '+/', '-_'), '=');

        if (!hash_equals($expectedSignature, $signature)) return false;

        $decodedPayload = json_decode(base64_decode(strtr($payload, '-_', '+/')), true);
        if ($decodedPayload['exp'] < time()) return false;

        return $decodedPayload;
    }
}
