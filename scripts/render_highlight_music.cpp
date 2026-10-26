#define TSF_IMPLEMENTATION
#include "tsf.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <string>
#include <vector>

struct Voice { int program; bool drums; float gain; };
struct Event { double time; int channel, note, velocity; bool on; };
using Events = std::vector<Event>;
static void note(Events& e, int ch, int pitch, double at, double length, int velocity) { e.push_back({at,ch,pitch,velocity,true}); e.push_back({at+length,ch,pitch,0,false}); }

static std::pair<std::vector<Voice>, Events> arrange(const std::string& name, double duration) {
  Events e;
  if (name == "baroque") {
    std::vector<Voice> v={{48,0,.78f},{40,0,.70f},{42,0,.68f}}; double step=.28,t=0; int i=0; int up[]={76,79,81,83,84,81,79,76,77,81,84,86,84,81,77,74}, lo[]={52,55,57,59,60,57,55,52,53,57,60,62,60,57,53,50};
    while(t<duration){note(e,1,up[i%16],t,step*.92,82);note(e,0,lo[(i+4)%16]+12,t,step*.9,68);if(i%4==0)note(e,2,lo[i%16]-12,t,step*3.8,68);i++;t+=step;} return {v,e};
  }
  if (name == "waltz") {
    std::vector<Voice> v={{0,0,.74f},{42,0,.78f}}; double beat=.52,t=0; int i=0, roots[]={48,55,53,50}, melody[]={60,64,67,65,64,72,69,67,62,65,69,67};
    while(t<duration){int root=roots[(i/3)%4];if(i%3==0)note(e,1,root,t,beat*2.8,72);else for(int p:{root+12,root+16,root+19})note(e,0,p,t,beat*.78,60);note(e,1,melody[i%12],t,beat*.86,76);i++;t+=beat;} return {v,e};
  }
  if (name == "nocturne") {
    std::vector<Voice> v={{0,0,.82f}}; double step=.42,t=0; int i=0,roots[]={45,41,48,43},mel[]={69,72,76,81,79,76,74,72,71,74,79,77,74,71,69,68},arp[]={0,12,15,19,24,19,15,12};
    while(t<duration){int root=roots[(i/8)%4];note(e,0,root+arp[i%8],t,step*1.7,56);if(i%2==0)note(e,0,mel[(i/2)%16],t,step*2.9,82);i++;t+=step;} return {v,e};
  }
  if (name == "sunrise") {
    std::vector<Voice> v={{0,0,.80f}}; double step=.48,t=0; int i=0,roots[]={48,43,45,41},mel[]={64,67,69,72,71,69,67,64,69,72,76,74,72,71,69,67};
    while(t<duration){int root=roots[(i/4)%4];if(i%4==0){note(e,0,root,t,step*3.8,70);for(int p:{root+12,root+16,root+19})note(e,0,p,t,step*3.6,53);}if(i%2==0)note(e,0,mel[(i/2)%16],t,step*2.05,82);i++;t+=step;} return {v,e};
  }
  if (name == "roadtrip") {
    std::vector<Voice> v={{81,0,.60f},{38,0,.72f},{89,0,.42f},{0,1,.72f}}; double step=.25,t=0; int i=0,roots[]={40,36,43,45},hook[]={76,76,79,83,81,79,76,74,76,79,81,84,83,81,79,76};
    while(t<duration){int root=roots[(i/8)%4];if(i%2==0)note(e,0,hook[i%16],t,step*1.65,76);note(e,1,root,t,step*.82,72);if(i%8==0)for(int p:{root+12,root+16,root+19})note(e,2,p,t,step*7.5,51);if(i%2==0)note(e,3,36,t,.1,88);if(i%4==2)note(e,3,38,t,.1,72);if(i%2==1)note(e,3,42,t,.06,46);i++;t+=step;} return {v,e};
  }
  if (name == "indie") {
    std::vector<Voice> v={{27,0,.68f},{89,0,.40f},{33,0,.62f},{0,1,.54f}}; double step=.4,t=0; int i=0,roots[]={47,43,50,45},mel[]={71,74,78,74,69,73,76,73,67,71,74,71,66,69,73,69};
    while(t<duration){int root=roots[(i/8)%4];note(e,0,mel[i%16],t,step*1.42,70);if(i%2==0)note(e,1,root+12+(i%4==0?0:7),t,step*1.55,49);if(i%4==0){note(e,2,root,t,step*3.7,68);note(e,3,36,t,.1,62);}if(i%4==2)note(e,3,38,t,.1,51);if(i%4==3)note(e,3,42,t,.06,38);i++;t+=step;} return {v,e};
  }
  std::vector<Voice> v={{0,0,.78f},{48,0,.40f}}; double step=.3,t=0; int i=0,roots[]={48,45,53,55},riff[]={0,4,7,12,7,4,9,7,0,4,9,12,9,7,4,2};
  while(t<duration){int root=roots[(i/8)%4];note(e,0,root+12+riff[i%16],t,step*1.45,76);if(i%4==0)note(e,0,root,t,step*3.8,70);if(i%8==4)note(e,1,root+19,t,step*3.6,46);i++;t+=step;} return {v,e};
}

static void reverb(std::vector<float>& audio, int rate, float wet) {
  const int delays[]={int(rate*.071),int(rate*.089),int(rate*.113)}; auto dry=audio;
  for(int d:delays) for(size_t i=d*2;i<audio.size();++i) audio[i]+=audio[i-d*2]*wet/3.0f;
  for(size_t i=0;i<audio.size();++i) audio[i]=std::tanh(audio[i]*.92f)*.86f + dry[i]*.14f;
}
static void wav(const std::string& path,const std::vector<float>& audio,int rate){FILE*f=fopen(path.c_str(),"wb");uint32_t data=audio.size()*2,total=36+data;uint16_t fmt=1,ch=2,bits=16,align=4;uint32_t byteRate=rate*align;fwrite("RIFF",1,4,f);fwrite(&total,4,1,f);fwrite("WAVEfmt ",1,8,f);uint32_t sixteen=16;fwrite(&sixteen,4,1,f);fwrite(&fmt,2,1,f);fwrite(&ch,2,1,f);fwrite(&rate,4,1,f);fwrite(&byteRate,4,1,f);fwrite(&align,2,1,f);fwrite(&bits,2,1,f);fwrite("data",1,4,f);fwrite(&data,4,1,f);for(float x:audio){int16_t s=std::clamp(int(x*32767),-32768,32767);fwrite(&s,2,1,f);}fclose(f);}

int main(int argc,char**argv){if(argc<3)return 1;std::filesystem::create_directories(argv[2]);const int rate=44100;for(std::string name:{"baroque","waltz","nocturne","sunrise","roadtrip","indie","celebration"}){tsf*sf=tsf_load_filename(argv[1]);if(!sf){fprintf(stderr,"Could not load soundfont\n");return 2;}tsf_set_output(sf,TSF_STEREO_INTERLEAVED,rate,-7);auto [voices,events]=arrange(name,24);for(size_t i=0;i<voices.size();++i){tsf_channel_set_presetnumber(sf,i,voices[i].program,voices[i].drums);tsf_channel_set_volume(sf,i,voices[i].gain);}std::sort(events.begin(),events.end(),[](auto&a,auto&b){return a.time==b.time?a.on<b.on:a.time<b.time;});int frames=int(26.2*rate),cursor=0;size_t ei=0;std::vector<float>audio(frames*2);while(cursor<frames){while(ei<events.size()&&int(events[ei].time*rate)<=cursor){auto&e=events[ei++];if(e.on)tsf_channel_note_on(sf,e.channel,e.note,e.velocity/127.f);else tsf_channel_note_off(sf,e.channel,e.note);}int next=ei<events.size()?int(events[ei].time*rate):frames,nextBlock=std::min(frames,std::max(cursor+1,next));tsf_render_float(sf,audio.data()+cursor*2,nextBlock-cursor,0);cursor=nextBlock;}reverb(audio,rate,name=="roadtrip"?.12f:.18f);wav(std::string(argv[2])+"/"+name+".wav",audio,rate);tsf_close(sf);printf("Rendered %s\n",name.c_str());}return 0;}
