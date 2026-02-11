use std::cmp::Reverse;
use std::collections::BinaryHeap;

const SIZE: usize = 50 * 50;
const MIN_PLANE_CNT: i16 = 140;

#[derive(Clone)]
struct UnionFind {
    parent: [usize; SIZE],
}

impl UnionFind {
    fn new() -> Self {
        let mut parent = [0usize; SIZE];
        for (i, p) in parent.iter_mut().enumerate() {
            *p = i;
        }
        Self { parent }
    }

    fn find(&mut self, x: usize) -> usize {
        let mut r = x;
        while self.parent[r] != r {
            r = self.parent[r];
        }
        let mut cur = x;
        while self.parent[cur] != cur {
            let t = self.parent[cur];
            self.parent[cur] = r;
            cur = t;
        }
        r
    }

    fn union(&mut self, a: usize, b: usize) -> usize {
        let ra = self.find(a);
        let rb = self.find(b);
        if ra == rb {
            return ra;
        }
        if ra > rb {
            self.parent[ra] = rb;
            rb
        } else {
            self.parent[rb] = ra;
            ra
        }
    }
}

#[inline]
fn xy_to_idx(x: i32, y: i32) -> Option<usize> {
    if (0..50).contains(&x) && (0..50).contains(&y) {
        Some((x as usize) * 50 + (y as usize))
    } else {
        None
    }
}

#[inline]
fn idx_to_xy(i: usize) -> (i32, i32) {
    ((i / 50) as i32, (i % 50) as i32)
}

fn for4(i: usize, mut f: impl FnMut(usize)) {
    let (x, y) = idx_to_xy(i);
    const D4: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];
    for (dx, dy) in D4 {
        if let Some(n) = xy_to_idx(x + dx, y + dy) {
            f(n);
        }
    }
}

fn for8(i: usize, mut f: impl FnMut(usize)) {
    let (x, y) = idx_to_xy(i);
    for dx in -1..=1 {
        for dy in -1..=1 {
            if dx == 0 && dy == 0 {
                continue;
            }
            if let Some(n) = xy_to_idx(x + dx, y + dy) {
                f(n);
            }
        }
    }
}

fn border_cells() -> impl Iterator<Item = usize> {
    let mut v = Vec::with_capacity(196);
    for y in 0..50usize {
        v.push(y);
        v.push(49 * 50 + y);
    }
    for x in 1..49usize {
        v.push(x * 50);
        v.push(x * 50 + 49);
    }
    v.into_iter()
}

fn block_put_able_count(
    uf: &mut UnionFind,
    root: usize,
    walkable: &[u8; SIZE],
    cache: &mut [i16; SIZE],
) -> i16 {
    if cache[root] >= 0 {
        return cache[root];
    }

    let mut room_manor = [false; SIZE];
    for (i, v) in room_manor.iter_mut().enumerate() {
        *v = uf.find(i) == root;
    }

    for i in 0..SIZE {
        if !room_manor[i] {
            continue;
        }
        let mut manor_cnt = 0;
        let mut wall_cnt = 0;
        for4(i, |n| {
            if room_manor[n] {
                manor_cnt += 1;
            }
            if walkable[n] == 0 {
                wall_cnt += 1;
            }
        });
        if manor_cnt == 1 && wall_cnt == 0 {
            room_manor[i] = false;
        }
    }

    for start in 0..SIZE {
        let mut stack = Vec::with_capacity(32);
        stack.push(start);
        while let Some(i) = stack.pop() {
            if room_manor[i] || walkable[i] == 0 {
                continue;
            }
            let mut manor_cnt = 0;
            let mut wall_cnt = 0;
            for4(i, |n| {
                if room_manor[n] {
                    manor_cnt += 1;
                }
                if walkable[n] == 0 {
                    wall_cnt += 1;
                }
            });
            if manor_cnt >= 2 || (manor_cnt == 1 && wall_cnt >= 2) {
                room_manor[i] = true;
                for4(i, |n| stack.push(n));
            }
        }
    }

    for b in border_cells() {
        if walkable[b] == 0 {
            continue;
        }
        room_manor[b] = false;
        for8(b, |n| room_manor[n] = false);
    }

    let mut visited = [false; SIZE];
    let mut queue: BinaryHeap<Reverse<(i16, usize)>> = BinaryHeap::new();
    for i in 0..SIZE {
        if !room_manor[i] {
            queue.push(Reverse((if walkable[i] > 0 { -4 } else { -1 }, i)));
        }
    }

    let mut inner_cnt: i16 = 0;
    while let Some(Reverse((k, i))) = queue.pop() {
        visited[i] = true;
        if k >= -1 {
            for4(i, |n| {
                if !visited[n] {
                    visited[n] = true;
                    queue.push(Reverse((k + 1, n)));
                    if room_manor[n] && walkable[n] > 0 && k + 1 >= 0 {
                        inner_cnt += 1;
                    }
                }
            });
        } else {
            for8(i, |n| {
                if !visited[n] {
                    visited[n] = true;
                    queue.push(Reverse((k + 1, n)));
                    if room_manor[n] && walkable[n] > 0 && k + 1 >= 0 {
                        inner_cnt += 1;
                    }
                }
            });
        }
    }

    cache[root] = inner_cnt;
    inner_cnt
}

#[derive(Copy, Clone)]
struct DfsFrame {
    idx: usize,
    phase: u8,
    mode: u8, // 0 up, 1 down
}

fn compute_block_impl(
    walkable: &[u8; SIZE],
    score: &[f32; SIZE],
    route_dist: &[i16; SIZE],
    blocked: Option<&[u8; SIZE]>,
    out_parent: &mut [i32],
    out_size: &mut [i16],
) {
    let mut uf = UnionFind::new();
    let mut visited = [false; SIZE];

    let mut start_points: Vec<usize> = Vec::with_capacity(SIZE);
    for i in 0..SIZE {
        if walkable[i] > 0 && route_dist[i] > 0 {
            start_points.push(i);
        }
    }
    start_points.sort_unstable_by(|&a, &b| route_dist[b].cmp(&route_dist[a]));

    let mut pos_seq_map: Vec<Vec<usize>> = vec![Vec::new(); SIZE];
    let mut size_map = [0i16; SIZE];

    for &current_pos in &start_points {
        if blocked.map_or(false, |b| b[current_pos] > 0) {
            uf.union(current_pos, 0);
            continue;
        }
        if visited[current_pos] {
            continue;
        }

        let mut cnt = 0i16;
        let mut pos_seq: Vec<usize> = Vec::new();
        let mut stack = Vec::with_capacity(64);
        stack.push(DfsFrame {
            idx: current_pos,
            phase: 0,
            mode: 0,
        });

        while let Some(frame) = stack.pop() {
            let i = frame.idx;
            if frame.phase == 0 {
                if visited[i] {
                    continue;
                }
                visited[i] = true;
                stack.push(DfsFrame {
                    idx: i,
                    phase: 1,
                    mode: frame.mode,
                });

                let current_value = score[i];
                if frame.mode == 0 {
                    for8(i, |n| {
                        let v = score[n];
                        if v > current_value && current_value < 6.0 {
                            stack.push(DfsFrame {
                                idx: n,
                                phase: 0,
                                mode: 0,
                            });
                        } else if v > 0.0 && v < current_value {
                            stack.push(DfsFrame {
                                idx: n,
                                phase: 0,
                                mode: 1,
                            });
                        }
                    });
                } else {
                    for4(i, |n| {
                        let v = score[n];
                        if v > 0.0 && v < current_value {
                            stack.push(DfsFrame {
                                idx: n,
                                phase: 0,
                                mode: 1,
                            });
                        }
                    });
                }
            } else {
                let blocked_here = blocked.map_or(false, |b| b[i] > 0);
                let fi = uf.find(i);
                let fc = uf.find(current_pos);
                if fi != 0 && fc != 0 && !blocked_here {
                    uf.union(current_pos, i);
                    pos_seq.push(i);
                    cnt += 1;
                } else if blocked.is_some() {
                    uf.union(i, 0);
                }
            }
        }

        if cnt > 0 {
            let root = uf.find(current_pos);
            size_map[root] = cnt;
            pos_seq_map[root] = pos_seq;
        }
    }

    for b in border_cells() {
        if walkable[b] == 0 {
            continue;
        }
        let p = uf.find(b);
        size_map[p] = 0;
        for8(b, |n| {
            if walkable[n] > 0 {
                let pn = uf.find(n);
                size_map[pn] = 0;
            }
        });
    }
    size_map[0] = 0;

    let mut queue: BinaryHeap<Reverse<(i16, usize)>> = BinaryHeap::new();
    for p in 0..SIZE {
        if size_map[p] > 0 {
            queue.push(Reverse((size_map[p], p)));
        }
    }

    let mut putable_cache = [-1i16; SIZE];
    while let Some(Reverse((k, pos))) = queue.pop() {
        if size_map[pos] != k {
            continue;
        }

        let seq = &pos_seq_map[pos];
        if seq.is_empty() {
            continue;
        }
        let mut visited2 = [false; SIZE];
        let mut near_cnt_map = [0i16; SIZE];

        for &e in seq {
            for8(e, |n| {
                if walkable[n] > 0 && !visited2[n] {
                    visited2[n] = true;
                    let cp = uf.find(n);
                    if cp == pos {
                        return;
                    }
                    let cs = size_map[cp];
                    if cs > 0 && cs < 300 {
                        near_cnt_map[cp] += 1;
                    }
                }
            });
        }

        let mut target_pos: Option<usize> = None;
        let mut near_cnt: i16 = 0;
        let mut max_ratio = 0f32;
        for current_pos in 0..SIZE {
            let near = near_cnt_map[current_pos];
            if near <= 0 {
                continue;
            }
            let current_size = size_map[current_pos];
            if current_size <= 0 {
                continue;
            }
            let ratio = (near as f32) / f32::sqrt(i16::min(current_size, k) as f32);
            let better = if (ratio - max_ratio).abs() < f32::EPSILON {
                target_pos.map_or(true, |tp| current_size < size_map[tp])
            } else {
                ratio > max_ratio
            };
            if better {
                target_pos = Some(current_pos);
                max_ratio = ratio;
                near_cnt = near;
            }
        }
        for current_pos in 0..SIZE {
            let near = near_cnt_map[current_pos];
            if near > near_cnt {
                target_pos = Some(current_pos);
                near_cnt = near;
            }
        }
        let Some(tp) = target_pos else { continue };
        let min_size = size_map[tp];
        if min_size <= 0 {
            continue;
        }

        let target_putable = if min_size > MIN_PLANE_CNT {
            block_put_able_count(&mut uf, tp, walkable, &mut putable_cache)
        } else {
            0
        };
        let pos_putable = if k > MIN_PLANE_CNT {
            block_put_able_count(&mut uf, pos, walkable, &mut putable_cache)
        } else {
            0
        };

        if i16::max(target_putable, pos_putable) < MIN_PLANE_CNT {
            let merged_root = uf.union(pos, tp);
            let cnt = k + min_size;
            if pos != merged_root {
                size_map[pos] = 0;
            } else {
                size_map[tp] = 0;
            }
            size_map[merged_root] = cnt;

            let mut merged = Vec::with_capacity(pos_seq_map[pos].len() + pos_seq_map[tp].len());
            merged.extend_from_slice(&pos_seq_map[tp]);
            merged.extend_from_slice(&pos_seq_map[pos]);
            pos_seq_map[merged_root] = merged;
            if pos != merged_root {
                pos_seq_map[pos].clear();
            } else {
                pos_seq_map[tp].clear();
            }
            putable_cache[merged_root] = -1;
            putable_cache[tp] = -1;
            putable_cache[pos] = -1;
            queue.push(Reverse((cnt, merged_root)));
        }
    }

    for i in 0..SIZE {
        out_parent[i] = uf.find(i) as i32;
        out_size[i] = size_map[i];
    }
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[no_mangle]
pub extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    unsafe {
        let _ = Vec::from_raw_parts(ptr, 0, len);
    }
}

#[no_mangle]
pub extern "C" fn compute_block(
    walk_ptr: *const u8,
    score_ptr: *const f32,
    route_ptr: *const i16,
    blocked_ptr: *const u8,
    has_blocked: u32,
    out_parent_ptr: *mut i32,
    out_size_ptr: *mut i16,
) {
    if walk_ptr.is_null() || score_ptr.is_null() || route_ptr.is_null() || out_parent_ptr.is_null() || out_size_ptr.is_null() {
        return;
    }
    unsafe {
        let walk_slice = std::slice::from_raw_parts(walk_ptr, SIZE);
        let score_slice = std::slice::from_raw_parts(score_ptr, SIZE);
        let route_slice = std::slice::from_raw_parts(route_ptr, SIZE);
        let out_parent = std::slice::from_raw_parts_mut(out_parent_ptr, SIZE);
        let out_size = std::slice::from_raw_parts_mut(out_size_ptr, SIZE);

        let mut walk = [0u8; SIZE];
        let mut score = [0f32; SIZE];
        let mut route = [0i16; SIZE];
        walk.copy_from_slice(walk_slice);
        score.copy_from_slice(score_slice);
        route.copy_from_slice(route_slice);

        if has_blocked != 0 && !blocked_ptr.is_null() {
            let blocked_slice = std::slice::from_raw_parts(blocked_ptr, SIZE);
            let mut blocked = [0u8; SIZE];
            blocked.copy_from_slice(blocked_slice);
            compute_block_impl(&walk, &score, &route, Some(&blocked), out_parent, out_size);
        } else {
            compute_block_impl(&walk, &score, &route, None, out_parent, out_size);
        }
    }
}

#[no_mangle]
pub extern "C" fn get_block_putable_count(
    walk_ptr: *const u8,
    parent_ptr: *const i32,
    root: i32,
) -> i32 {
    if walk_ptr.is_null() || parent_ptr.is_null() || root < 0 {
        return -1;
    }
    let root_usize = root as usize;
    if root_usize >= SIZE {
        return -1;
    }

    unsafe {
        let walk_slice = std::slice::from_raw_parts(walk_ptr, SIZE);
        let parent_slice = std::slice::from_raw_parts(parent_ptr, SIZE);

        let mut walk = [0u8; SIZE];
        walk.copy_from_slice(walk_slice);

        let mut uf = UnionFind::new();
        for (i, p) in parent_slice.iter().enumerate() {
            let v = *p as isize;
            uf.parent[i] = if v >= 0 && (v as usize) < SIZE {
                v as usize
            } else {
                i
            };
        }

        let mut cache = [-1i16; SIZE];
        block_put_able_count(&mut uf, root_usize, &walk, &mut cache) as i32
    }
}

#[no_mangle]
pub extern "C" fn find_lab_anchor(
    manor_ptr: *const i16,
    storage_x: i32,
    storage_y: i32,
) -> i32 {
    if manor_ptr.is_null() {
        return -1;
    }
    if !(0..50).contains(&storage_x) || !(0..50).contains(&storage_y) {
        return -1;
    }

    unsafe {
        let manor = std::slice::from_raw_parts(manor_ptr, SIZE);
        let mut best_x = -1i32;
        let mut best_y = -1i32;
        let mut best_dist = f32::MAX;

        for x in 0..50i32 {
            for y in 0..50i32 {
                let idx = (x as usize) * 50 + (y as usize);
                if manor[idx] < 2 {
                    continue;
                }

                let det_x = storage_x as f32 - x as f32 - 1.5;
                let det_y = storage_y as f32 - y as f32 - 1.5;
                let dist = f32::sqrt(det_x * det_x + det_y * det_y);
                if dist >= best_dist {
                    continue;
                }

                let mut ok = true;
                for i in 0..4i32 {
                    for j in 0..4i32 {
                        let tx = x + i;
                        let ty = y + j;
                        if tx < 0 || tx >= 50 || ty < 0 || ty >= 50 {
                            ok = false;
                            break;
                        }
                        let tidx = (tx as usize) * 50 + (ty as usize);
                        if manor[tidx] <= 0 || (tx - storage_x).abs() + (ty - storage_y).abs() <= 2 {
                            ok = false;
                            break;
                        }
                    }
                    if !ok {
                        break;
                    }
                }

                if ok {
                    best_dist = dist;
                    best_x = x;
                    best_y = y;
                }
            }
        }

        if best_x < 0 || best_y < 0 {
            -1
        } else {
            best_x * 50 + best_y
        }
    }
}
