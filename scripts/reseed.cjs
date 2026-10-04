// 重新 place-spawn 拉起新 attempt（一次性）
const fs = require('fs');
const s = JSON.parse(fs.readFileSync('.secret.json', 'utf8'));
const cfg = s.servers['xx-local'].accounts.Rosmarin;
const base = 'http://localhost:21035';

(async () => {
    const d = await fetch(base + '/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cfg.email, password: cfg.password }),
    }).then((r) => r.json());
    const h = { 'X-Token': d.token };

    const r = await fetch(base + '/api/game/place-spawn', {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Spawn1', room: 'E2S2', x: 25, y: 25 }),
    });
    console.log(r.status, JSON.stringify(await r.json().catch(() => null)));
    const time = await fetch(base + '/api/game/time').then((r) => r.json());
    console.log('tick:', time.time);
    const race = await fetch(base + '/api/race').then((r) => r.json());
    console.log('active:', JSON.stringify(race.active));
})();
