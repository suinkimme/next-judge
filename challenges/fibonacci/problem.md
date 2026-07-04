---
title: "피보나치 수열"
time_limit: "1s"
memory_limit: "256MB"
tags:
  - 다이나믹 프로그래밍
  - 수학
samples:
  - input: "5"
    output: "5"
  - input: "10"
    output: "55"
---

피보나치 수열에서 N번째 항을 구하는 문제입니다.

피보나치 수열은 다음과 같이 정의됩니다:
- F(1) = 1
- F(2) = 1  
- F(n) = F(n-1) + F(n-2) (n ≥ 3)

### 입력

첫째 줄에 정수 N이 주어진다.

- $1 \leq N \leq 90$

### 출력

N번째 피보나치 수를 출력한다.
