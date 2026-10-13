import json,sys,os,math,datetime
D=sys.argv[1]; L=lambda f: json.load(open(os.path.join(D,f)))
SPOTS=json.load(open(sys.argv[3]))
def fnum(v):
  try: return float(v)
  except (TypeError,ValueError): return None
r1=lambda v: None if v is None else round(v,2)

OW=L('openwave.json'); OW=OW if isinstance(OW,list) else [OW]
cw=L('coastal.json')['cwaopendata']
COAST={l['LocationName']:l for l in cw['Dataset']['Locations']['Location']}
TIDE={x['Location']['LocationId']:x['Location'] for x in L('tide.json')['records']['TideForecasts']}
SUN={l['CountyName']:l['time'] for l in L('sun.json')['records']['locations']['location']}
BUOY={l['Station']['StationID']:l['StationObsTimes']['StationObsTime'] for l in L('buoy.json')['Records']['SeaSurfaceObs']['Location']}
OBS={s['StationId']:s for s in L('obs.json')['records']['Station']}
DIR={'偏北風':0,'東北風':45,'偏東風':90,'東南風':135,'偏南風':180,'西南風':225,'偏西風':270,'西北風':315}
SKY={'晴天':'Sunny','多雲':'Cloudy','陰天':'Overcast'}
CMP={k:i*22.5 for i,k in enumerate(['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'])}
def distbear(LAT,LON,la,lo):
  p1,p2,dl=math.radians(LAT),math.radians(la),math.radians(lo-LON)
  d=2*math.asin(math.sqrt(math.sin((p2-p1)/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2))*3440.065
  b=(math.degrees(math.atan2(math.sin(dl)*math.cos(p2),math.cos(p1)*math.sin(p2)-math.sin(p1)*math.cos(p2)*math.cos(dl)))+360)%360
  return round(d),round(b)

# Typhoons: CWA W-C0034-005 latest analysis fix.
tc=L('typhoon.json')['records'].get('TropicalCyclones') or {}
tcs=tc.get('TropicalCyclone') or []
if isinstance(tcs,dict): tcs=[tcs]
FIX=[]
for s in tcs:
  fx=s['AnalysisData']['Fix']; f=fx[-1] if isinstance(fx,list) else fx; FIX.append((s,f))

def buoyrows(sid):
  out=[]
  for x in sorted(BUOY.get(sid,[]),key=lambda x:x['DateTime']):
    w=x['WeatherElements']; r=[x['DateTime'][:16]]+[fnum(w.get(k)) for k in ('WaveHeight','WavePeriod','WaveDirection','SeaTemperature')]
    if None not in r[1:4]: out.append(r)
  return out[-24:]

spots={}; src={}
for n,S in enumerate(SPOTS):
  # Wave forecast: Open-Meteo marine, Météo-France MFWAM, nearest sea point.
  o=OW[n]['hourly']
  hourly=[[o['time'][i], r1(o['wave_height'][i]), r1(o['wave_period'][i]), o['wave_direction'][i], r1(o['swell_wave_height'][i]), r1(o['swell_wave_period'][i]), o['swell_wave_direction'][i], r1(o['wind_wave_height'][i])] for i in range(len(o['time'])) if o['wave_height'][i] is not None]
  # Wind + sky: CWA coastal forecast F-D0047-095 for the spot's township coast.
  E={e['ElementName']:e['Time'] for e in COAST[S['coast']]['WeatherElement']}
  wind=[]
  for i,t in enumerate(E['風速']):
    wd=E['風向'][i]['ElementValue']['WindDirection']; w=E['天氣現象'][i]['ElementValue']['Weather']
    wind.append([t['DataTime'][:16], float(t['ElementValue']['WindSpeedKts']), DIR.get(wd), ('Rain' if '雨' in (w or '') else SKY.get(w,w)), fnum(E['浪高'][i]['ElementValue']['WaveHeight'])])
  # Tides: CWA F-A0021-001 surf-spot tide point.
  DAYS=sorted({t[:10] for t in o['time']})
  tides={}
  for d in sorted(TIDE[S['tide']]['TimePeriods']['Daily'],key=lambda d:d['Date']):
    if d['Date']<=DAYS[-1]: tides[d['Date']]=[[x['DateTime'][11:16], 'H' if x['Tide']=='滿潮' else 'L', int(x['TideHeights']['AboveTWVD'])] for x in d['Time']]
  # Sun: CWA A-B0062-001 by county.
  sun={x['Date']:{'first':x['BeginCivilTwilightTime'],'rise':x['SunRiseTime'],'set':x['SunSetTime'],'last':x['EndCivilTwilightTime'],'phen':[]} for x in SUN[S['county']] if x['Date'] in DAYS}
  # Buoy: CWA O-B0075-001, first listed buoy with readings in the last day (later ids are backups).
  bid=S['buoy'][0]; buoy=buoyrows(bid)
  for b in S['buoy'][1:]:
    alt=buoyrows(b)
    if alt and (not buoy or buoy[-1][0][:10]<alt[-1][0][:10]): bid,buoy=b,alt
  # Station wind: CWA O-A0001-001 (m/s -> kt).
  st=OBS.get(S['station']); dwind=[]
  if st:
    we=st['WeatherElement']; ws=fnum(we.get('WindSpeed'))
    if ws is not None and ws>=0: dwind=[[st['ObsTime']['DateTime'][:16], round(ws*1.944,1), float(we['WindDirection'])]]
  # Typhoons: distance/bearing from this spot.
  storms=[]
  for s,f in FIX:
    kt=round(float(f['MaxWindSpeed'])*1.944); dist,bear=distbear(S['lat'],S['lon'],float(f['CoordinateLatitude']),float(f['CoordinateLongitude']))
    kind='Typhoon' if kt>=64 else 'Tropical storm' if kt>=34 else 'Tropical depression'
    name=(s.get('TyphoonName') or '').title() or ('TD '+s.get('CwaTdNo',''))
    storms.append({'name':name,'kind':kind,'id':s.get('CwaTyphoonName') or ('TD'+s.get('CwaTdNo','')),'distNm':dist,'bearing':bear,'heading':CMP.get(f.get('MovingDirection'),0),
      'kt':kt,'gust':round(float(f.get('MaxGustSpeed') or 0)*1.944),'mb':int(float(f['Pressure'])),'swell':None})
  storms.sort(key=lambda s:s['distNm'])
  meta={k:S[k] for k in ('name','full','region','buoyName','stationName','off','lat','lon','blurb','cams')}; meta['zh']=S.get('zh') or {}  # Traditional Chinese names for the 中文 view
  spots[S['id']]=dict(meta,buoyId=bid,buoyAt=buoy[-1][0] if buoy else '',hourly=hourly,wind=wind,tides=tides,sun=sun,buoy=buoy,dwind=dwind,storms=storms)
  src[S['id']]=(buoy[-1][0] if buoy else '')+'/'+(dwind[-1][0] if dwind else '')

# Freshness key parts: latest source times.
src={'coastal':cw.get('Sent',''),'spots':src}
snap={'updated':datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),'src':src,'order':[S['id'] for S in SPOTS],'spots':spots}
json.dump(snap,open(sys.argv[2],'w'),separators=(',',':'),ensure_ascii=False)
print(os.path.getsize(sys.argv[2])); print(json.dumps(src)); print({k:(v['buoyId'],len(v['buoy']),len(v['hourly']),len(v['wind']),len(v['tides']),len(v['sun']),len(v['storms'])) for k,v in spots.items()})
