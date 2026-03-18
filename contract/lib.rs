#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, contracterror, Env, Address, Vec, String, Symbol};

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PollError {
    NotInitialized = 1,
    AlreadyVoted   = 2,
    InvalidOption  = 3,
    AlreadyInit    = 4,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

const KEY_RESULTS:  &str = "results";
const KEY_OPTIONS:  &str = "options";
const KEY_QUESTION: &str = "question";
const KEY_INIT:     &str = "initialized";

fn voted_key(env: &Env, voter: &Address) -> (Symbol, Address) {
    (Symbol::new(env, "voted"), voter.clone())
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct PollContract;

#[contractimpl]
impl PollContract {

    /// Initialize the poll once with a question and option labels.
    pub fn initialize(env: Env, question: String, options: Vec<String>) -> Result<(), PollError> {
        if env.storage().persistent().has(&Symbol::new(&env, KEY_INIT)) {
            return Err(PollError::AlreadyInit);
        }

        let mut results: Vec<u32> = Vec::new(&env);
        for _ in 0..options.len() {
            results.push_back(0u32);
        }

        env.storage().persistent().set(&Symbol::new(&env, KEY_QUESTION), &question);
        env.storage().persistent().set(&Symbol::new(&env, KEY_OPTIONS),  &options);
        env.storage().persistent().set(&Symbol::new(&env, KEY_RESULTS),  &results);
        env.storage().persistent().set(&Symbol::new(&env, KEY_INIT),     &true);

        Ok(())
    }

    /// Cast a vote for an option index. Each address may only vote once.
    pub fn vote(env: Env, option: u32, voter: Address) -> Result<(), PollError> {
        voter.require_auth();

        if !env.storage().persistent().has(&Symbol::new(&env, KEY_INIT)) {
            return Err(PollError::NotInitialized);
        }

        let options: Vec<String> = env.storage().persistent()
            .get(&Symbol::new(&env, KEY_OPTIONS))
            .unwrap_or(Vec::new(&env));

        if option >= options.len() {
            return Err(PollError::InvalidOption);
        }

        let vk = voted_key(&env, &voter);
        if env.storage().persistent().has(&vk) {
            return Err(PollError::AlreadyVoted);
        }

        let mut results: Vec<u32> = env.storage().persistent()
            .get(&Symbol::new(&env, KEY_RESULTS))
            .unwrap_or(Vec::new(&env));

        let current = results.get(option).unwrap_or(0);
        results.set(option, current + 1);

        env.storage().persistent().set(&Symbol::new(&env, KEY_RESULTS), &results);
        env.storage().persistent().set(&vk, &true);

        Ok(())
    }

    /// Return vote counts for every option.
    pub fn get_results(env: Env) -> Vec<u32> {
        env.storage().persistent()
            .get(&Symbol::new(&env, KEY_RESULTS))
            .unwrap_or(Vec::new(&env))
    }

    /// Return the option labels.
    pub fn get_options(env: Env) -> Vec<String> {
        env.storage().persistent()
            .get(&Symbol::new(&env, KEY_OPTIONS))
            .unwrap_or(Vec::new(&env))
    }

    /// Return the poll question.
    pub fn get_question(env: Env) -> String {
        env.storage().persistent()
            .get(&Symbol::new(&env, KEY_QUESTION))
            .unwrap_or(String::from_str(&env, ""))
    }

    /// Check whether an address has already voted.
    pub fn has_voted(env: Env, voter: Address) -> bool {
        env.storage().persistent().has(&voted_key(&env, &voter))
    }
}

mod test;