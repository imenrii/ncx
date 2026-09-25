mod cf;
mod cli;
mod dataset;
mod hub;
mod policy;
mod reading;
mod server;
mod storage;

pub type NcxResult<T> = Result<T, String>;

#[tokio::main(worker_threads = 2)]
async fn main() {
    if let Err(message) = cli::run().await {
        eprintln!("ncx: {message}");
        std::process::exit(1);
    }
}
