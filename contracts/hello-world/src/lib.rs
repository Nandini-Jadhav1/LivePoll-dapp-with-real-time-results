#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Env, String, Vec,
    Symbol, symbol_short,
};

mod star_token {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32-unknown-unknown/release/star_token.wasm"
    );
}

#[contracttype]
pub enum DataKey {
    Question,
    Options,
    Results,
    Voted(Address),
    TokenContract,
}

#[contract]
pub struct StarVote;

#[contractimpl]
impl StarVote {
    pub fn initialize(
        env: Env,
        question: String,
        options: Vec<String>,
        token_contract: Address,
    ) {
        let results: Vec<u32> = Vec::from_array(&env, [0u32; 4]);
        env.storage().instance().set(&DataKey::Question, &question);
        env.storage().instance().set(&DataKey::Options, &options);
        env.storage().instance().set(&DataKey::Results, &results);
        // Store token contract address for inter-contract call
        env.storage().instance().set(&DataKey::TokenContract, &token_contract);
    }

    pub fn vote(env: Env, option_index: u32, voter: Address) {
        voter.require_auth();

        // Prevent double voting
        let voted: bool = env.storage().persistent()
            .get(&DataKey::Voted(voter.clone()))
            .unwrap_or(false);
        if voted {
            panic!("already voted");
        }

        // Record vote
        let mut results: Vec<u32> = env.storage().instance()
            .get(&DataKey::Results).unwrap();
        let current = results.get(option_index).unwrap();
        results.set(option_index, current + 1);
        env.storage().instance().set(&DataKey::Results, &results);
        env.storage().persistent().set(&DataKey::Voted(voter.clone()), &true);

        // ── INTER-CONTRACT CALL: mint 10 STAR tokens to voter ──
        let token_addr: Address = env.storage().instance()
            .get(&DataKey::TokenContract).unwrap();
        let token_client = star_token::Client::new(&env, &token_addr);
        token_client.mint_reward(&voter, &10_i128);

        // Emit event for real-time streaming
        env.events().publish(
            (symbol_short!("voted"),),
            (voter, option_index)
        );
    }

    pub fn get_question(env: Env) -> String {
        env.storage().instance().get(&DataKey::Question).unwrap()
    }

    pub fn get_options(env: Env) -> Vec<String> {
        env.storage().instance().get(&DataKey::Options).unwrap()
    }

    pub fn get_results(env: Env) -> Vec<u32> {
        env.storage().instance().get(&DataKey::Results).unwrap()
    }

    pub fn has_voted(env: Env, voter: Address) -> bool {
        env.storage().persistent()
            .get(&DataKey::Voted(voter))
            .unwrap_or(false)
    }

    pub fn get_token_balance(env: Env, addr: Address) -> i128 {
        let token_addr: Address = env.storage().instance()
            .get(&DataKey::TokenContract).unwrap();
        let token_client = star_token::Client::new(&env, &token_addr);
        token_client.balance(&addr)
    }
}