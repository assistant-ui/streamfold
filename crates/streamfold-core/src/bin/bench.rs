use std::hint::black_box;
use std::time::Instant;
use streamfold_core::JsonStreamParser;

fn payload(item_count: usize) -> Vec<u8> {
    let mut text = String::with_capacity(item_count * 80);
    text.push_str(r#"{"tool":"write_records","items":["#);
    for index in 0..item_count {
        if index > 0 {
            text.push(',');
        }
        text.push_str(&format!(
            r#"{{"id":{index},"name":"record-{index}","enabled":true,"tags":["alpha","beta"]}}"#
        ));
    }
    text.push_str(r#"],"metadata":{"source":"benchmark","nested":{"depth":3}}}"#);
    text.into_bytes()
}

fn percentile(values: &mut [f64], percentile: f64) -> f64 {
    values.sort_by(|a, b| a.total_cmp(b));
    values[((values.len() - 1) as f64 * percentile).round() as usize]
}

fn main() {
    let sizes = [1_000, 10_000, 50_000];
    let chunks = [16, 256, 4096];
    let mut first = true;
    print!("[");

    for target_size in sizes {
        let data = payload(target_size / 72);
        for chunk_size in chunks {
            let iterations = if data.len() > 500_000 { 12 } else { 30 };
            let mut samples = Vec::with_capacity(iterations);

            for _ in 0..iterations {
                let started = Instant::now();
                let mut parser = JsonStreamParser::new();
                for chunk in data.chunks(chunk_size) {
                    black_box(parser.push(black_box(chunk)).unwrap());
                }
                assert!(parser.state().complete);
                samples.push(started.elapsed().as_secs_f64() * 1000.0);
            }

            let median = percentile(&mut samples.clone(), 0.5);
            let p95 = percentile(&mut samples, 0.95);
            if !first {
                print!(",");
            }
            first = false;
            print!(
                r#"{{"implementation":"rust-native","bytes":{},"chunkSize":{},"medianMs":{:.6},"p95Ms":{:.6},"iterations":{},"charactersVisited":{}}}"#,
                data.len(),
                chunk_size,
                median,
                p95,
                iterations,
                data.len()
            );
        }
    }
    println!("]");
}
