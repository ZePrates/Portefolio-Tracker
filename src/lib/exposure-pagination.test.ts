import { describe, expect, it } from 'vitest';
import { readExposurePages } from './exposure-pagination';
describe('complete holdings pagination', () => {
 it('reads all 3900 holdings using inclusive 1000-row ranges', async () => {
  const source = Array.from({length:3900}, (_, id) => ({id})); const ranges: number[][]=[];
  const result = await readExposurePages(async (from,to) => { ranges.push([from,to]); return {data:source.slice(from,to+1),error:null}; });
  expect(ranges).toEqual([[0,999],[1000,1999],[2000,2999],[3000,3999]]); expect(result).toEqual(source);
 });
 it('checks a further page at an exact boundary', async () => { const ranges: number[]=[]; const rows=await readExposurePages(async from => {ranges.push(from);return {data:from===0?Array.from({length:1000},(_,i)=>i):[],error:null};});expect(rows).toHaveLength(1000);expect(ranges).toEqual([0,1000]); });
 it('does not return silently truncated data when a later page fails', async () => { await expect(readExposurePages(async from => ({data:from===0?Array(1000).fill(1):null,error:from?{message:'failed page'}:null}))).rejects.toThrow('failed page'); });
});
