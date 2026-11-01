shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;
uniform float legMesh = 0.0;
uniform vec3 shoulderLeft = vec3(-0.48,2.18,0.0);
uniform vec3 shoulderRight = vec3(0.48,2.18,0.0);
uniform vec3 elbowLeft = vec3(-0.35,1.98,0.4);
uniform vec3 elbowRight = vec3(0.4,1.98,0.3);
uniform float hasAtlas = 0.0;
uniform sampler2D atlas : source_color, filter_linear_mipmap;
uniform vec3 legTint = vec3(0.23,0.30,0.25);
mat3 rotate_x(float a) {float s=sin(a),c=cos(a);return mat3(vec3(1.0,0.0,0.0),vec3(0.0,c,s),vec3(0.0,-s,c));}
void vertex() {
  vec4 pose=INSTANCE_CUSTOM;
  float gait=sin(pose.x)*pose.y;
  if(legMesh>0.5) {
    if(VERTEX.y < -0.5) {
      mat3 knee=rotate_x(max(0.0,-gait)*0.75);
      VERTEX=knee*(VERTEX-vec3(0.0,-0.5,0.0))+vec3(0.0,-0.5,0.0);
      NORMAL=knee*NORMAL;
    }
  } else {
    float part=floor(UV2.x+0.5),angle=gait*0.06;
    vec3 pivot=part<3.5?shoulderLeft:shoulderRight;
    if(pose.z>1.5 && pose.z<2.5) angle += sin(pose.w)*0.18;
    if(pose.z>2.5) angle += sin(pose.w)*0.22;
    if(part>5.5) pivot=shoulderRight;
    if(part>1.5) {
      if(part==3.0 || part>=5.0) {
        vec3 elbow=part==3.0?elbowLeft:elbowRight;
        mat3 r=rotate_x(pose.z>1.5?sin(pose.w)*0.18:0.0);
        VERTEX=r*(VERTEX-elbow)+elbow; NORMAL=r*NORMAL;
      }
      mat3 r=rotate_x(angle);VERTEX=r*(VERTEX-pivot)+pivot;NORMAL=r*NORMAL;
    }
    if(part>5.5) VERTEX.z-=pose.z==1.0?pose.w*0.025:0.0;
  }
}
void fragment() {
  vec3 detail=hasAtlas>0.5?texture(atlas,UV).rgb:vec3(1.0);
  ALBEDO=mix(COLOR.rgb,legTint,clamp(COLOR.a,0.0,1.0))*detail;
  ROUGHNESS=0.86;
  METALLIC=0.06;
}
