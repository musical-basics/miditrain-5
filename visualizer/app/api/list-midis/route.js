import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET() {
  try {
    const rootDir = path.resolve(process.cwd(), '..');
    const midisFiles = await fs.readdir(path.join(rootDir, 'midis'), { withFileTypes: true }).catch(() => []);

    const allMidis = [];
    allMidis.push({ label: 'Pathetique Full Chunk', value: 'pathetique_full_chunk' });

    for (const f of midisFiles) {
      if (f.isFile() && f.name.endsWith('.mid')) {
        const key = f.name.replace('.mid', '');
        if (key === 'pathetique_full_chunk') continue;
        allMidis.push({ label: `Uploaded: ${f.name}`, value: 'midis/' + f.name });
      }
    }

    return NextResponse.json({ midis: allMidis });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
