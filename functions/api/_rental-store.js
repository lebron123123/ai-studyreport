// Shared public observations only. Never stores private project IDs, names or reports.
import {rentalInRange,rentalFresh,rentalStatistics} from '../../project-map/rental-core.mjs';
export async function rentalHash(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function ensureRentalStore(DB){
 await DB.prepare('CREATE TABLE IF NOT EXISTS map_rental_observations (id TEXT PRIMARY KEY, url TEXT NOT NULL, kind TEXT NOT NULL, district TEXT NOT NULL, street TEXT NOT NULL, lon DOUBLE PRECISION NOT NULL, lat DOUBLE PRECISION NOT NULL, observed_at BIGINT NOT NULL, data TEXT NOT NULL)').run();
 await DB.prepare('CREATE INDEX IF NOT EXISTS map_rental_geo ON map_rental_observations(kind,lon,lat)').run();
 await DB.prepare('CREATE TABLE IF NOT EXISTS map_rental_runs (id TEXT PRIMARY KEY, query TEXT NOT NULL, state TEXT NOT NULL, lease_until BIGINT NOT NULL, updated_at BIGINT NOT NULL, data TEXT NOT NULL)').run();
 await DB.prepare('CREATE TABLE IF NOT EXISTS map_rental_slots (id INTEGER PRIMARY KEY, lease_until BIGINT NOT NULL, owner TEXT NOT NULL)').run();
 for(const id of [1,2])await DB.prepare('INSERT INTO map_rental_slots(id,lease_until,owner) VALUES(?,0,?) ON CONFLICT(id) DO NOTHING').bind(id,'').run();
}
export async function saveRentalObservation(DB,row){
 // One snapshot per canonical URL/price/day, independent of searcher and search channel.
 const identity=[row.url,row.community,row.monthlyRent,row.area,Math.floor(row.observedAt/86400000),row.market||'rent',row.saleUnitPrice||null];
 if(row.rentRange)identity.push(row.rentRange,row.areaRange);
 const id=await rentalHash(identity);
 await DB.prepare('INSERT INTO map_rental_observations(id,url,kind,district,street,lon,lat,observed_at,data) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,row.url,row.kind,row.district,row.street,row.point[0],row.point[1],row.observedAt,JSON.stringify({...row,id})).run();
 return id;
}
export async function readRentalObservations(DB,query){
 const [lon,lat]=query.point,delta=query.radius/95000;
 const result=await DB.prepare('SELECT data FROM map_rental_observations WHERE kind=? AND lon>=? AND lon<=? AND lat>=? AND lat<=? ORDER BY observed_at DESC LIMIT 1001').bind(query.kind,lon-delta,lon+delta,lat-delta,lat+delta).all();
 const seen=new Set(),items=[];
 for(const record of result.results||[]){const row=JSON.parse(record.data),key=JSON.stringify([row.url,row.community,row.referenceKind||'direct']);if(!rentalInRange(row,query)||seen.has(key))continue;seen.add(key);items.push({...row,stale:!rentalFresh(row)});}
 return {items:items.slice(0,300),truncated:(result.results||[]).length>1000||items.length>300,statistics:rentalStatistics(items)};
}
