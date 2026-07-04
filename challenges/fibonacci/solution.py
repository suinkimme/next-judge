n = int(input())

if n == 1 or n == 2:
    print(1)
else:
    a, b = 1, 1
    for _ in range(n - 2):
        a, b = b, a + b
    print(b)
