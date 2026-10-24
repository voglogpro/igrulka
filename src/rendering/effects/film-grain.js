// Integer avalanche noise avoids the directional bands of a floating-point sine hash.
export const FILM_GRAIN_GLSL = `
float filmGrain(vec2 pixel,float clock){
 uvec2 p=uvec2(pixel);uint frame=uint(floor(clock*24.));
 uint h=(p.x*0x1f123bb5u)^(p.y*0x5f356495u)^(frame*0x9e3779b9u);
 h^=h>>16;h*=0x7feb352du;h^=h>>15;h*=0x846ca68bu;h^=h>>16;
 return float(h&0x00ffffffu)/16777216.-.5;
}`;
