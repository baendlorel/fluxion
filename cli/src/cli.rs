use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "fluxion")]
#[command(about = "Fluxion hot-reload server runner", long_about = None)]
pub struct Args {
    #[arg(short, long, default_value = "main.ts")]
    pub entry: String,

    #[arg(long, default_value = ".fluxion/fluxion.log")]
    pub logfile: String,

    #[arg(long, default_value = ".")]
    pub cwd: String,

    #[arg(long, default_value = "9335")]
    pub port: u16,

    #[arg(short = 'd', long, default_value = "false", action = clap::ArgAction::SetTrue)]
    pub daemon: bool,
}
