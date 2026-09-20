// Small local symbols for known OpenMapTiles POIs absent from the Bright sprite.
// Do not mask arbitrary missing images: unknown IDs still reach MapLibre diagnostics.
const patterns={
 gate:['...............','..#.........#..','..###########..','..#....#....#..','..#....#....#..','..#....#....#..','..#.........#..'],
 lift_gate:['...............','..#............','..###########..','..#............','..#............','..#............','..#............'],
 bollard:['......###......','......###......','......###......','......###......','......###......','.....#####.....'],
 cycle_barrier:['...............','..########.....','..#......#.....','..#....########','..#....#....#..','.......#....#..'],
 swimming_pool:['...............','..##.....##....','.#..#...#..#...','.....###....##.','..##.....##....','.#..#...#..#...','.....###....##.'],
 running:['.......##......','.......##......','.....###.......','...##..###.....','.......#..##...','......#.#......','....##...##....']
};
export function missingMapIcon(id){
 const rows=patterns[id];if(!rows)return null;
 const width=30,height=20,data=new Uint8Array(width*height*4);
 rows.forEach((row,y)=>[...row].forEach((v,x)=>{if(v!=='#')return;for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const i=((y*2+dy+2)*width+x*2+dx)*4;data.set([87,105,114,255],i);}}));
 return {width,height,data};
}
export function attachMissingMapIcons(map){
 const handle=e=>{if(map.hasImage(e.id))return;const image=missingMapIcon(e.id);if(image)map.addImage(e.id,image,{pixelRatio:2});};
 map.on('styleimagemissing',handle);
 return ()=>map.off('styleimagemissing',handle);
}
