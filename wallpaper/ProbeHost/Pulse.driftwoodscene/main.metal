float4 driftwoodMain(float2 fragCoord, constant DriftwoodMetalUniforms &uniforms) {
    float2 uv = fragCoord / uniforms.resolution;
    float2 center = float2(0.25 + 0.4 * sin(uniforms.time), 0.5);
    float circle = 1.0 - smoothstep(0.075, 0.09, distance(uv, center));
    float3 sky = float3(0.04, 0.12, 0.18);
    float3 sun = float3(0.96, 0.71, 0.39);
    return float4(mix(sky, sun, circle), 1.0);
}
